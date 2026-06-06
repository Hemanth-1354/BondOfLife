import json
import logging
from datetime import datetime, timedelta
from typing import Optional, List
from fastapi import FastAPI, HTTPException, Query, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from aws_services import (
    db_get_item, db_put_item, db_scan_table, 
    ses_send_email, get_email_logs, query_bedrock
)
from backend.auth import create_token, get_current_user
from matching_engine import (
    score_donors, create_blood_request, 
    log_outreach_failure, log_outreach_success, 
    trigger_wave_outreach, check_and_escalate_sla
)

# Setup logger
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("main")

app = FastAPI(title="BondOfLife API", description="AI-Enabled Blood Care Coordination Backend")

# Setup CORS for React frontend (Vite defaults to port 5173)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # In development allow all; restrict in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Pydantic Schemas ---
class RequestSubmission(BaseModel):
    patient_id: str
    blood_group: str
    quantity: float
    priority: str # "Emergency" or "Routine"
    latitude: float
    longitude: float

class AvailabilityUpdate(BaseModel):
    language: str
    consent: bool
    user_donation_active_status: str # "Active" or "Inactive"

class EmailReplySimulation(BaseModel):
    email_id: str
    donor_id: str
    reply_text: str

class InventoryUpdate(BaseModel):
    blood_group: str
    units: int

# --- API Endpoints ---

@app.get("/")
def read_root():
    return {"status": "healthy", "service": "BondOfLife Care Coordination Core"}

# --- Donors ---
@app.get("/api/donors")
def get_donors():
    """Fetches all registered donors."""
    return db_scan_table("DonorRegistry")

@app.get("/api/donors/{donor_id}")
def get_donor_profile(donor_id: str):
    """Fetches a specific donor's profile."""
    donor = db_get_item("DonorRegistry", donor_id)
    if not donor:
        raise HTTPException(status_code=404, detail="Donor not found")
    # Fetch their learning profile/adjustments as well
    stats = db_get_item("FailureLearningStats", donor_id)
    donor["learning_stats"] = stats or {}
    return donor

@app.put("/api/donors/{donor_id}/preferences")
def update_donor_preferences(donor_id: str, data: AvailabilityUpdate):
    """Updates donor language, consent, and active status."""
    donor = db_get_item("DonorRegistry", donor_id)
    if not donor:
        raise HTTPException(status_code=404, detail="Donor not found")
        
    donor["language"] = data.language
    donor["consent"] = data.consent
    donor["user_donation_active_status"] = data.user_donation_active_status
    
    db_put_item("DonorRegistry", donor_id, donor)
    return {"message": "Preferences updated successfully", "donor": donor}

# --- Patients & Blood Bridge Requests ---
@app.get("/api/requests")
def get_requests():
    """Fetches all blood bridge request statuses."""
    return db_scan_table("BloodBridges")

@app.post("/api/requests")
def submit_request(data: RequestSubmission, background_tasks: BackgroundTasks):
    """Submits a blood request, runs matching engine, and initiates Wave 1 outreach."""
    req_id = create_blood_request(
        data.patient_id, data.blood_group, data.quantity, 
        data.priority, data.latitude, data.longitude
    )
    if not req_id:
        raise HTTPException(status_code=400, detail="No compatible donors found or database error.")
        
    # Schedule background check for SLA escalation
    # In a real system, this is a cron/scheduler, we'll emulate SLA escalation periodically or via trigger
    background_tasks.add_task(check_and_escalate_sla)
    
    return {"message": "Blood request created, Wave 1 outreach triggered", "request_id": req_id}

@app.post("/api/requests/{request_id}/force-escalate")
def force_escalate_request(request_id: str):
    """Allows coordinators to manually bypass the SLA timer and trigger the next wave."""
    bridge = db_get_item("BloodBridges", request_id)
    if not bridge:
        raise HTTPException(status_code=404, detail="Request not found")
    if bridge["status"] != "MATCHING":
        raise HTTPException(status_code=400, detail="Request is not in matching state")
        
    next_wave = bridge["current_wave"] + 1
    bridge["outreach_logs"].append({
        "timestamp": datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S"),
        "event": "Manual Escalation",
        "message": f"Coordinator bypassed SLA timer. Triggering Wave {next_wave}."
    })
    db_put_item("BloodBridges", request_id, bridge)
    trigger_wave_outreach(request_id, next_wave)
    return {"message": f"Wave {next_wave} outreach triggered.", "bridge": db_get_item("BloodBridges", request_id)}

# --- Email Outreach Responder ---
@app.get("/api/outreach/respond")
def handle_email_response(request_id: str, donor_id: str, action: str):
    """Processes quick-action links clicked in outreach emails."""
    bridge = db_get_item("BloodBridges", request_id)
    donor = db_get_item("DonorRegistry", donor_id)
    
    if not bridge:
        return {"status": "error", "message": "Request not found or expired"}
    if not donor:
        return {"status": "error", "message": "Donor not found"}
        
    if bridge["status"] != "MATCHING":
        return {"status": "already_resolved", "message": f"This request is already {bridge['status']}"}
        
    if action == "accept":
        # 1. Update Bridge Record
        bridge["status"] = "CONFIRMED"
        bridge["matched_donor_id"] = donor_id
        bridge["outreach_logs"].append({
            "timestamp": datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S"),
            "event": "Accepted",
            "message": f"Donor {donor_id[:8]} accepted blood request via email link."
        })
        db_put_item("BloodBridges", request_id, bridge)
        
        # 2. Record AI Success
        log_outreach_success(donor_id)
        
        # 3. Send Confirmation Email to Donor
        confirm_subject = "Appointment Scheduled - BondOfLife"
        confirm_body = f"""
            <h3>Donation Confirmed!</h3>
            <p>Dear Donor,</p>
            <p>Thank you for accepting. Your appointment is scheduled at <strong>Hyderabad Central Hospital</strong>.</p>
            <p>Please report to the blood donation center within 24 hours.</p>
            <p>Thank you for saving a life!</p>
        """
        ses_send_email(f"{donor_id[:8]}@example.com", confirm_subject, confirm_body)
        
        return {
            "status": "success", 
            "message": "Thank you! Your donation appointment is confirmed. Details sent to your email."
        }
        
    elif action == "decline":
        # 1. Log failure in AI learning
        log_outreach_failure(donor_id, "Declined via quick email action link")
        
        # 2. Update outreach logs for the bridge
        bridge["outreach_logs"].append({
            "timestamp": datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S"),
            "event": "Declined",
            "message": f"Donor {donor_id[:8]} declined request."
        })
        db_put_item("BloodBridges", request_id, bridge)
        
        # Check if all donors in current wave declined -> immediately trigger next wave
        current_wave_donors = bridge["waves"][bridge["current_wave"] - 1]
        
        # Count declines in logs
        declines = [log for log in bridge["outreach_logs"] if log["event"] == "Declined"]
        if len(declines) >= len(current_wave_donors):
            # Escalate wave immediately without waiting for SLA timer!
            next_wave = bridge["current_wave"] + 1
            bridge["outreach_logs"].append({
                "timestamp": datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S"),
                "event": "Wave Exhausted",
                "message": f"All donors in Wave {bridge['current_wave']} declined. Auto-triggering Wave {next_wave}."
            })
            db_put_item("BloodBridges", request_id, bridge)
            trigger_wave_outreach(request_id, next_wave)
            
        return {
            "status": "success", 
            "message": "Thank you for responding. We will reach out to other donors."
        }

    return {"status": "error", "message": "Invalid Action"}

# --- Live Email Simulator ---
@app.get("/api/outreach/emails")
def get_emails():
    """Returns outbound email logs (for the simulator UI)."""
    return get_email_logs()

@app.post("/api/outreach/reply")
def simulate_email_reply(data: EmailReplySimulation):
    """Simulates donor sending an unstructured email reply, parsed by Bedrock (Claude 3 Haiku)."""
    bridge = db_get_item("BloodBridges", data.email_id) # request_id is the key
    donor = db_get_item("DonorRegistry", data.donor_id)
    
    if not donor:
        raise HTTPException(status_code=404, detail="Donor not found")

    # Ask Bedrock (or fall back to local NLP) to extract donor response intent
    system_prompt = (
        "You are an NLP agent for a blood bank. Analyze the donor's email reply. "
        "Determine if they ACCEPT, DECLINE, or request to RESCHEDULE. "
        "Return a JSON format ONLY: "
        '{"intent": "donor_response", "status": "accepted|declined|rescheduled", "reason": "short explanation", '
        '"confidence": 0.99, "detected_language": "English|Hindi|Telugu|etc"}'
    )
    
    ai_analysis_raw = query_bedrock(data.reply_text, system_prompt)
    try:
        ai_analysis = json.loads(ai_analysis_raw)
    except Exception:
        # Fallback regex parser in case JSON load fail
        ai_analysis = {
            "status": "declined",
            "reason": "Could not parse email context, default to decline for safety",
            "confidence": 0.5,
            "detected_language": "English"
        }
        
    status = ai_analysis.get("status", "declined")
    reason = ai_analysis.get("reason", "No details")
    lang = ai_analysis.get("detected_language", "English")

    # Process response status
    if status == "accepted":
        if bridge and bridge["status"] == "MATCHING":
            bridge["status"] = "CONFIRMED"
            bridge["matched_donor_id"] = data.donor_id
            bridge["outreach_logs"].append({
                "timestamp": datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S"),
                "event": "Accepted (AI Parsed)",
                "message": f"AI parsed email reply as ACCEPT ({lang}): '{data.reply_text}'"
            })
            db_put_item("BloodBridges", bridge["request_id"], bridge)
            
            log_outreach_success(data.donor_id)
            
            # Send confirmation
            confirm_body = f"<p>Dear Donor,</p><p>We processed your email reply and scheduled your appointment. Thank you!</p>"
            ses_send_email(f"{data.donor_id[:8]}@example.com", "Appointment Confirmed", confirm_body)
    else:
        # Declined or Rescheduled
        log_outreach_failure(data.donor_id, reason)
        if bridge and bridge["status"] == "MATCHING":
            bridge["outreach_logs"].append({
                "timestamp": datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S"),
                "event": "Declined (AI Parsed)",
                "message": f"AI parsed email reply as DECLINE ({lang}) reason: {reason}. Text: '{data.reply_text}'"
            })
            db_put_item("BloodBridges", bridge["request_id"], bridge)
            
            # Trigger next wave if all declined
            current_wave_donors = bridge["waves"][bridge["current_wave"] - 1]
            declines = [log for log in bridge["outreach_logs"] if "Declined" in log["event"]]
            if len(declines) >= len(current_wave_donors):
                next_wave = bridge["current_wave"] + 1
                bridge["outreach_logs"].append({
                    "timestamp": datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S"),
                    "event": "Wave Exhausted",
                    "message": f"All donors in Wave {bridge['current_wave']} declined. Triggering Wave {next_wave}."
                })
                db_put_item("BloodBridges", bridge["request_id"], bridge)
                trigger_wave_outreach(bridge["request_id"], next_wave)
                
            # Send acknowledgement email
            decline_body = f"<p>Dear Donor,</p><p>Thank you for letting us know. We have recorded your unavailability.</p>"
            ses_send_email(f"{data.donor_id[:8]}@example.com", "Outreach Response Acknowledged", decline_body)

    return {
        "status": "processed",
        "ai_analysis": ai_analysis,
        "bridge": db_get_item("BloodBridges", bridge["request_id"]) if bridge else None
    }

# --- Management & Analytics ---
@app.get("/api/management/stats")
def get_management_stats():
    """Generates analytical metrics, demand forecasts, and churn insights."""
    donors = db_scan_table("DonorRegistry")
    bridges = db_scan_table("BloodBridges")
    learn_logs = db_scan_table("FailureLearningStats")
    
    # 1. Base KPIs
    total_donors = len(donors)
    eligible_donors = len([d for d in donors if d.get("eligibility_status") == "eligible"])
    active_bridges = len([b for b in bridges if b.get("status") in ["MATCHING", "CONFIRMED"]])
    
    # Average response time & conversion rate calculation
    total_completed = 0
    total_response_time_seconds = 0
    
    for b in bridges:
        if b.get("status") in ["COMPLETED", "CONFIRMED"] and len(b.get("outreach_logs", [])) > 0:
            total_completed += 1
            # Mock average response time of 12 minutes per successful match for analytics
            total_response_time_seconds += 720
            
    avg_response_minutes = (total_response_time_seconds / max(1, total_completed)) / 60.0
    conversion_rate = (total_completed / max(1, len(bridges))) * 100.0 if len(bridges) > 0 else 85.0
    
    # 2. 30-Day Demand Forecast (grouped by blood group and day offset)
    # Since we have patientExpected Transfusion Dates in Dataset.csv, we build a forecast
    # We will generate a nice mocked timeline from today for 30 days
    blood_groups = ["O Positive", "A Positive", "B Positive", "AB Positive", "O Negative", "A Negative", "B Negative", "AB Negative"]
    forecast_timeline = []
    
    for i in range(30):
        forecast_date = (datetime.now() + timedelta(days=i)).strftime("%b %d")
        daily_units = {}
        for bg in blood_groups:
            # Seed varying units required
            day_hash = (i + len(bg)) % 7
            daily_units[bg] = (day_hash * 2) if day_hash in [1, 3, 5] else 0
        forecast_timeline.append({
            "date": forecast_date,
            **daily_units
        })
        
    # 3. Donor Churn Risk List
    # Donors at risk of going inactive (high ratio, warnings, or consecutive failures)
    churn_risks = []
    for d in donors:
        ratio = d.get("calls_to_donations_ratio", 0.0)
        calls = d.get("total_calls", 0)
        status = d.get("user_donation_active_status", "Active")
        
        if status == "Inactive" or ratio > 4.0 or (calls > 8 and d.get("donations_till_date", 0) == 0):
            churn_risks.append({
                "donor_id": d["user_id"],
                "blood_group": d["blood_group"],
                "calls": calls,
                "ratio": ratio,
                "status": status,
                "reason": d.get("inactive_trigger_comment", "Low donation response rates.")
            })
            
    # 4. AI Autonomic Learning Ledger (Adjustments made)
    ledger_entries = []
    for l in learn_logs:
        for adj in l.get("learning_adjustments", []):
            ledger_entries.append({
                "donor_id": l["donor_id"],
                "timestamp": adj["timestamp"],
                "reason": adj["reason"],
                "action": adj["action"]
            })
    # Sort ledger entries by timestamp desc
    ledger_entries.sort(key=lambda x: x["timestamp"], reverse=True)
            
    return {
        "kpis": {
            "total_donors": total_donors,
            "eligible_donors": eligible_donors,
            "active_bridges": active_bridges,
            "avg_response_minutes": round(avg_response_minutes, 1),
            "conversion_rate_percent": round(conversion_rate, 1)
        },
        "forecast": forecast_timeline,
        "churn_risks": churn_risks[:10], # Limit to top 10
        "ai_ledger": ledger_entries[:15] # Limit to top 15
    }

# --- Hospital Inventory & Completion ---
# Seed local blood bank inventory
BLOOD_INVENTORY = {
    "O Positive": 12, "O Negative": 2, "A Positive": 8, "A Negative": 3,
    "B Positive": 9, "B Negative": 1, "AB Positive": 5, "AB Negative": 0
}

@app.get("/api/hospitals/inventory")
def get_hospital_inventory():
    """Returns local hospital blood bank inventory levels."""
    return [{"blood_group": bg, "units": qty} for bg, qty in BLOOD_INVENTORY.items()]

@app.put("/api/hospitals/inventory")
def update_hospital_inventory(data: InventoryUpdate):
    """Updates blood bank inventory quantities."""
    if data.blood_group not in BLOOD_INVENTORY:
        raise HTTPException(status_code=400, detail="Invalid blood group")
    BLOOD_INVENTORY[data.blood_group] = max(0, data.units)
    return {"message": "Inventory updated", "inventory": BLOOD_INVENTORY}

@app.post("/api/requests/{request_id}/complete")
def complete_donation(request_id: str):
    """Hospital confirms donation complete, increments donor statistics, and triggers thank-you cards."""
    bridge = db_get_item("BloodBridges", request_id)
    if not bridge:
        raise HTTPException(status_code=404, detail="Request not found")
    if bridge["status"] != "CONFIRMED":
        raise HTTPException(status_code=400, detail="Donation request is not confirmed by a donor yet")
        
    donor_id = bridge["matched_donor_id"]
    
    # 1. Update Bridge status
    bridge["status"] = "COMPLETED"
    bridge["outreach_logs"].append({
        "timestamp": datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S"),
        "event": "Completed",
        "message": f"Hospital confirmed successful donation from Donor {donor_id[:8]}."
    })
    db_put_item("BloodBridges", request_id, bridge)
    
    # 2. Record success (adds donation count, resets eligibility interval)
    log_outreach_success(donor_id)
    
    # 3. Update Hospital Inventory
    bg = bridge["blood_group"]
    BLOOD_INVENTORY[bg] = BLOOD_INVENTORY.get(bg, 0) + int(bridge["quantity_required"])
    
    # 4. Trigger Donor Impact Message (Email)
    thank_subject = "You Saved a Life! - BondOfLife"
    thank_body = f"""
        <div style='font-family:Arial,sans-serif;padding:20px;background:#fff5f5;border:2px solid #b30000;border-radius:10px;'>
            <h2 style='color:#b30000;text-align:center;'>♥ HERO OF LIFE ♥</h2>
            <p>Dear Donor,</p>
            <p>We are writing to express our deepest gratitude. The hospital has confirmed your blood donation was successfully transfused to a Thalassemia patient.</p>
            <p>For Thalassemia patients, blood is life. Your recurring commitment is the bridge that keeps them alive.</p>
            <p><strong>Impact Milestones:</strong> You have received the <strong>'Lifesaver' Badge</strong> on your profile wall!</p>
            <p style='text-align:center;font-size:24px;'>THANK YOU!</p>
        </div>
    """
    ses_send_email(f"{donor_id[:8]}@example.com", thank_subject, thank_body)
    
    return {"message": "Donation completed successfully. Donor notified and stats updated."}

# --- Authentication Endpoints ---
from pydantic import BaseModel

class LoginRequest(BaseModel):
    email: str
    role: str  # e.g., coordinator, donor, patient, etc.

@app.post("/api/login")
def login(data: LoginRequest):
    """Simple email‑based login returning a JWT.
    In a production system you would verify credentials; for MVP we accept any email/role.
    """
    token = create_token(data.email, data.role)
    return {"access_token": token, "token_type": "bearer"}