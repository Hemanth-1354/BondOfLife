import os
import math
import logging
import pandas as pd
from datetime import datetime, timedelta
from aws_services import db_put_item, db_get_item, db_scan_table, ses_send_email, query_bedrock

logger = logging.getLogger("matching_engine")

# --- Constants & Rules ---
DATASET_PATH = "Dataset.csv"

# Blood Compatibility (Recipient Blood Group -> List of Compatible Donor Blood Groups)
COMPATIBILITY_MAP = {
    "O Negative": ["O Negative"],
    "O Positive": ["O Positive", "O Negative"],
    "A Negative": ["A Negative", "O Negative"],
    "A Positive": ["A Positive", "A Negative", "O Positive", "O Negative"],
    "B Negative": ["B Negative", "O Negative"],
    "B Positive": ["B Positive", "B Negative", "O Positive", "O Negative"],
    "AB Negative": ["AB Negative", "A Negative", "B Negative", "O Negative"],
    "AB Positive": ["AB Positive", "AB Negative", "A Positive", "A Negative", "B Positive", "B Negative", "O Positive", "O Negative"]
}

# Average coordinates of Hyderabad if mapping defaults are needed
HYDERABAD_LAT = 17.3850
HYDERABAD_LON = 78.4867

# --- Utility Functions ---
def haversine_distance(lat1, lon1, lat2, lon2):
    """Calculates the great-circle distance between two points in kilometers."""
    if pd.isna(lat1) or pd.isna(lon1) or pd.isna(lat2) or pd.isna(lon2):
        return 999.0  # Large distance if missing
    try:
        R = 6371.0 # Earth's radius in km
        d_lat = math.radians(lat2 - lat1)
        d_lon = math.radians(lon2 - lon1)
        a = math.sin(d_lat / 2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(d_lon / 2)**2
        c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
        return R * c
    except Exception:
        return 999.0

# --- Dataset and Database Seeding ---
def seed_database_from_csv():
    """Reads Dataset.csv and seeds the DynamoDB tables for emulation if empty."""
    if not os.path.exists(DATASET_PATH):
        logger.warning(f"Dataset file {DATASET_PATH} not found. Seeding skipped.")
        return

    # Check if DonorRegistry is already seeded
    existing_donors = db_scan_table("DonorRegistry")
    if len(existing_donors) > 0:
        logger.info(f"DynamoDB already seeded with {len(existing_donors)} donors.")
        return

    logger.info("Reading CSV to seed emulated DynamoDB...")
    try:
        df = pd.read_csv(DATASET_PATH)
        # Drop rows without user_id
        df = df.dropna(subset=["user_id"])
        
        # Limit to 500 records to keep local databases fast but realistic
        df_seed = df.head(500)
        
        seeded_count = 0
        for _, row in df_seed.iterrows():
            role = str(row["role"])
            if "Donor" not in role:
                continue # Only seed donors in DonorRegistry
                
            user_id = str(row["user_id"])
            
            # Clean and construct the donor dict
            donor_data = {
                "user_id": user_id,
                "role": role,
                "blood_group": str(row["blood_group"]) if not pd.isna(row["blood_group"]) else "O Positive",
                "gender": str(row["gender"]) if not pd.isna(row["gender"]) else "Male",
                "latitude": float(row["latitude"]) if not pd.isna(row["latitude"]) else HYDERABAD_LAT,
                "longitude": float(row["longitude"]) if not pd.isna(row["longitude"]) else HYDERABAD_LON,
                "donor_type": str(row["donor_type"]) if not pd.isna(row["donor_type"]) else "Regular Donor",
                "eligibility_status": str(row["eligibility_status"]) if not pd.isna(row["eligibility_status"]) else "eligible",
                "donations_till_date": int(row["donations_till_date"]) if not pd.isna(row["donations_till_date"]) else 0,
                "total_calls": int(row["total_calls"]) if not pd.isna(row["total_calls"]) else 0,
                "calls_to_donations_ratio": float(row["calls_to_donations_ratio"]) if not pd.isna(row["calls_to_donations_ratio"]) else 1.0,
                "user_donation_active_status": str(row["user_donation_active_status"]) if not pd.isna(row["user_donation_active_status"]) else "Active",
                "language": "English", # Default language
                "consent": True, # Assume consent
                "registration_date": str(row["registration_date"]) if not pd.isna(row["registration_date"]) else datetime.now().isoformat()
            }
            
            # Write to database
            db_put_item("DonorRegistry", user_id, donor_data)
            seeded_count += 1
            
        logger.info(f"Seeded {seeded_count} donors into emulated DynamoDB.")
    except Exception as e:
        logger.error(f"Error seeding database: {e}")

# Call seed immediately
seed_database_from_csv()

# --- Intelligence Layer: AI Scoring & Ranking ---
def score_donors(patient_blood_group: str, patient_lat: float, patient_lon: float, is_emergency: bool = False):
    """Calculates matching scores for all eligible donors relative to patient requirement."""
    donors = db_scan_table("DonorRegistry")
    patient_bg_compatible = COMPATIBILITY_MAP.get(patient_blood_group, [patient_blood_group])
    
    scored_donors = []
    
    # Load all learning profiles at once
    learning_stats_list = db_scan_table("FailureLearningStats")
    learning_map = {item["donor_id"]: item for item in learning_stats_list}

    current_day = datetime.now().strftime("%A") # e.g. "Monday"

    for donor in donors:
        # 1. Eligibility Checks
        if donor.get("user_donation_active_status") == "Inactive":
            continue
        if donor.get("eligibility_status") == "not eligible":
            continue
        if not donor.get("consent", True):
            continue
            
        # Check blood group compatibility
        donor_bg = donor.get("blood_group")
        if donor_bg not in patient_bg_compatible:
            continue
            
        # 2. Compute Match Metrics
        dist = haversine_distance(patient_lat, patient_lon, donor.get("latitude"), donor.get("longitude"))
        
        # A. Compatibility Score (Perfect match gets bonus)
        comp_score = 100.0 if donor_bg == patient_blood_group else 80.0
        
        # B. Proximity Score (Closer is better, penalty for long distance)
        # 0 to 5km = 100, 5km to 30km = linear scale down, > 30km drops off
        if dist <= 5.0:
            prox_score = 100.0
        elif dist <= 30.0:
            prox_score = 100.0 - ((dist - 5.0) / 25.0) * 60.0 # scales down to 40
        else:
            prox_score = max(10.0, 40.0 - ((dist - 30.0) / 70.0) * 30.0) # drops to 10
            
        # C. Fatigue Penalty (Prevents burning out the same active donor)
        calls = donor.get("total_calls", 0)
        fatigue_penalty = min(30.0, calls * 2.0) # max 30 points penalty
        
        # D. Donation History Bonus (Regular donors who are responsive)
        donations = donor.get("donations_till_date", 0)
        ratio = donor.get("calls_to_donations_ratio", 1.0)
        # Responsiveness: low ratio of calls-to-donations is good
        resp_bonus = max(0.0, (5.0 - ratio) * 4.0) if donations > 0 else 0.0
        history_bonus = min(20.0, donations * 3.0) + resp_bonus
        
        # E. AI Failure Learning Adaptation (Refusal/SLA Penalty)
        learning = learning_map.get(donor.get("user_id"), {})
        fail_modifier = 1.0
        
        # If donor has declined weekday requests before, penalize if today is a weekday
        is_weekday = current_day not in ["Saturday", "Sunday"]
        if is_weekday and learning.get("weekday_refusals", 0) > 0:
            total_declines = learning.get("total_declines", 1)
            weekday_ratio = learning.get("weekday_refusals", 0) / total_declines
            fail_modifier -= (weekday_ratio * 0.4) # up to 40% reduction for weekday requests
            
        # General decline penalty
        if learning.get("total_declines", 0) > 0:
            decline_count = learning.get("total_declines", 0)
            fail_modifier -= min(0.3, decline_count * 0.05) # up to 30% reduction for general failures
            
        fail_modifier = max(0.1, fail_modifier) # keep it above 10%
        
        # 3. Aggregate Final Score
        # Formula: Weighted sum modified by self-learning failures
        base_score = (comp_score * 0.4) + (prox_score * 0.35) + (history_bonus * 0.25) - fatigue_penalty
        final_score = max(1.0, base_score * fail_modifier)
        
        scored_donors.append({
            "donor": donor,
            "distance_km": round(dist, 2),
            "compatibility_type": "Exact" if donor_bg == patient_blood_group else "Compatible",
            "base_score": round(base_score, 1),
            "final_score": round(final_score, 1),
            "fail_modifier": round(fail_modifier, 2),
            "reasons": learning.get("last_decline_reason", "")
        })
        
    # Sort by final score descending
    scored_donors.sort(key=lambda x: x["final_score"], reverse=True)
    return scored_donors

# --- Adaptive Failure Learning System ---
def log_outreach_failure(donor_id: str, reason: str, request_day: str = None):
    """Updates donor failure parameters and adjusts matching engine weights dynamically."""
    if not request_day:
        request_day = datetime.now().strftime("%A")
        
    # 1. Fetch current statistics
    stats = db_get_item("FailureLearningStats", donor_id)
    if not stats:
        stats = {
            "donor_id": donor_id,
            "total_declines": 0,
            "weekday_refusals": 0,
            "weekend_refusals": 0,
            "last_decline_reason": "",
            "last_decline_date": "",
            "learning_adjustments": []
        }
        
    # 2. Update Refusal Stats
    stats["total_declines"] += 1
    stats["last_decline_reason"] = reason
    stats["last_decline_date"] = datetime.now().isoformat()
    
    is_weekday = request_day not in ["Saturday", "Sunday"]
    if is_weekday:
        stats["weekday_refusals"] += 1
        adj_msg = f"Learned profile: Decreased weekday compatibility score. Reason: {reason}"
    else:
        stats["weekend_refusals"] += 1
        adj_msg = f"Learned profile: Decreased weekend compatibility score. Reason: {reason}"
        
    stats["learning_adjustments"].append({
        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "reason": reason,
        "day": request_day,
        "action": adj_msg
    })
    
    # Save statistics
    db_put_item("FailureLearningStats", donor_id, stats)
    
    # 3. Update Donor Registry counts
    donor = db_get_item("DonorRegistry", donor_id)
    if donor:
        donor["total_calls"] = donor.get("total_calls", 0) + 1
        donor["calls_to_donations_ratio"] = round(donor["total_calls"] / max(1, donor.get("donations_till_date", 0)), 2)
        
        # If failure count is too high without successful donation, mark as warning/inactive
        if stats["total_declines"] >= 5 and donor.get("donations_till_date", 0) == 0:
            donor["user_donation_active_status"] = "Inactive"
            donor["inactive_trigger_comment"] = "Auto-deactivated: 5 consecutive declines with zero donations."
            
        db_put_item("DonorRegistry", donor_id, donor)
        
    logger.info(f"AI failure logged for Donor {donor_id}: {reason}. Adjusted learning profile.")
    return stats

def log_outreach_success(donor_id: str):
    """Resets/mitigates decline rates upon a successful donation."""
    stats = db_get_item("FailureLearningStats", donor_id)
    if stats:
        # Mitigate penalty by dividing decline records (reinforcement learning)
        stats["total_declines"] = max(0, stats["total_declines"] - 1)
        stats["weekday_refusals"] = max(0, stats["weekday_refusals"] - 1)
        stats["weekend_refusals"] = max(0, stats["weekend_refusals"] - 1)
        db_put_item("FailureLearningStats", donor_id, stats)
        
    donor = db_get_item("DonorRegistry", donor_id)
    if donor:
        donor["donations_till_date"] = donor.get("donations_till_date", 0) + 1
        donor["total_calls"] = donor.get("total_calls", 0) + 1
        donor["calls_to_donations_ratio"] = round(donor["total_calls"] / donor["donations_till_date"], 2)
        donor["eligibility_status"] = "not eligible" # Ineligible until cycle passes
        
        # Set next eligible date to 90 days from now
        next_date = datetime.now() + timedelta(days=90)
        donor["next_eligible_date"] = next_date.strftime("%Y-%m-%d")
        donor["last_donation_date"] = datetime.now().strftime("%Y-%m-%d")
        db_put_item("DonorRegistry", donor_id, donor)
        
    logger.info(f"AI Success recorded for Donor {donor_id}. Reset compatibility penalties.")

# --- Wave-Based SLA Escalation Engine ---
def create_blood_request(patient_id: str, blood_group: str, quantity: float, priority: str, lat: float, lon: float):
    """Creates a new blood bridge request and begins Wave 1 email outreach."""
    request_id = f"req_{int(datetime.utcnow().timestamp())}"
    
    # 1. Match and score donors
    matches = score_donors(blood_group, lat, lon)
    
    if not matches:
        logger.warning(f"No compatible donors found for Patient {patient_id} ({blood_group})")
        return None
        
    # Slice matched donors into waves of 3
    waves = []
    chunk_size = 3
    for i in range(0, len(matches), chunk_size):
        waves.append([m["donor"]["user_id"] for m in matches[i:i+chunk_size]])
        
    # 2. Build Blood Bridge record
    bridge_record = {
        "request_id": request_id,
        "patient_id": patient_id,
        "blood_group": blood_group,
        "quantity_required": quantity,
        "priority": priority, # e.g. "Emergency", "Routine"
        "latitude": lat,
        "longitude": lon,
        "status": "MATCHING",
        "current_wave": 1,
        "total_waves": len(waves),
        "waves": waves, # List of list of donor ids
        "matched_donor_id": "",
        "created_at": datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S"),
        "wave_started_at": datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S"),
        "sla_duration_hours": 1 if priority == "Emergency" else 4,
        "outreach_logs": []
    }
    
    db_put_item("BloodBridges", request_id, bridge_record)
    
    # 3. Trigger Wave 1 Emails
    trigger_wave_outreach(request_id, 1)
    
    return request_id

def trigger_wave_outreach(request_id: str, wave_num: int):
    """Sends notification emails to all donors in the specified wave."""
    bridge = db_get_item("BloodBridges", request_id)
    if not bridge or bridge["status"] != "MATCHING":
        return
        
    waves = bridge.get("waves", [])
    if wave_num > len(waves):
        # We ran out of waves! Escalate to coordinator
        bridge["status"] = "ESCALATED"
        bridge["outreach_logs"].append({
            "timestamp": datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S"),
            "event": "Escalation",
            "message": "All donor waves exhausted. Manual coordinator intervention required."
        })
        db_put_item("BloodBridges", request_id, bridge)
        logger.warning(f"Request {request_id} escalated: waves exhausted.")
        return
        
    donor_ids = waves[wave_num - 1]
    bridge["current_wave"] = wave_num
    bridge["wave_started_at"] = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
    
    event_msg = f"Wave {wave_num} outreach triggered to {len(donor_ids)} compatible donors."
    bridge["outreach_logs"].append({
        "timestamp": datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S"),
        "event": f"Wave {wave_num} Started",
        "message": event_msg
    })
    
    db_put_item("BloodBridges", request_id, bridge)
    
    # Send email to each donor in the wave
    for donor_id in donor_ids:
        donor = db_get_item("DonorRegistry", donor_id)
        if not donor:
            continue
            
        # Personalized Multi-lingual Email Template
        lang = donor.get("language", "English")
        donor_email = f"{donor_id[:8]}@example.com" # Anonymized fake email for demo
        
        # Multilingual content translations
        subject = f"URGENT: Blood Donation Needed - BondOfLife"
        greet = "Dear Donor"
        body = f"A Thalassemia patient needs a matching blood transfusion of group **{bridge['blood_group']}** near Hyderabad.<br>"
        actions_html = f"""
            <div style='margin-top:20px;'>
                <a href='http://localhost:8000/api/outreach/respond?request_id={request_id}&donor_id={donor_id}&action=accept' style='background:#b30000;color:white;padding:10px 20px;text-decoration:none;border-radius:5px;margin-right:10px;'>ACCEPT</a>
                <a href='http://localhost:8000/api/outreach/respond?request_id={request_id}&donor_id={donor_id}&action=decline' style='background:#555;color:white;padding:10px 20px;text-decoration:none;border-radius:5px;'>DECLINE</a>
            </div>
        """
        
        if lang == "Hindi":
            subject = "अति आवश्यक: रक्त दान की आवश्यकता - BondOfLife"
            greet = "प्रिय रक्तदाता"
            body = f"हैदराबाद में एक थैलेसीमिया रोगी को **{bridge['blood_group']}** समूह के रक्त चढ़ाने की तत्काल आवश्यकता है।<br>"
        elif lang == "Telugu":
            subject = "అత్యవసరం: రక్తదానం అవసరం - BondOfLife"
            greet = "ప్రియమైన దాత"
            body = f"హైదరాబాద్‌లో ఒక థలసేమియా రోగికి **{bridge['blood_group']}** రక్తమార్పిడి తక్షణమే అవసరం.<br>"

        html_content = f"""
            <div style='font-family:Arial,sans-serif;padding:20px;border:1px solid #ddd;'>
                <h2 style='color:#b30000;'>{subject}</h2>
                <p><strong>{greet},</strong></p>
                <p>{body}</p>
                <p>Quantity Required: {bridge['quantity_required']} Unit(s)</p>
                <p>Priority: {bridge['priority']}</p>
                <p>Please click one of the actions below to respond immediately:</p>
                {actions_html}
                <p style='margin-top:20px;font-size:12px;color:#777;'>BondOfLife DPDPA Secure Outreach. You can opt out at any time.</p>
            </div>
        """
        
        ses_send_email(donor_email, subject, html_content)
        
    logger.info(f"Triggered Wave {wave_num} outreach for Request {request_id}.")

def check_and_escalate_sla():
    """Polls active requests, and escalates waves if SLA expires without response."""
    active_bridges = db_scan_table("BloodBridges")
    for bridge in active_bridges:
        if bridge["status"] != "MATCHING":
            continue
            
        # Check SLA
        created_time = datetime.strptime(bridge["wave_started_at"], "%Y-%m-%d %H:%M:%S")
        sla_hours = bridge.get("sla_duration_hours", 2)
        elapsed = datetime.utcnow() - created_time
        
        if elapsed > timedelta(hours=sla_hours):
            # SLA expired! Trigger next wave
            next_wave = bridge["current_wave"] + 1
            logger.info(f"SLA expired for Wave {bridge['current_wave']} of Request {bridge['request_id']}. Escalating to Wave {next_wave}.")
            
            bridge["outreach_logs"].append({
                "timestamp": datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S"),
                "event": "SLA Expired",
                "message": f"Wave {bridge['current_wave']} SLA expired. Triggering Wave {next_wave}."
            })
            db_put_item("BloodBridges", bridge["request_id"], bridge)
            
            trigger_wave_outreach(bridge["request_id"], next_wave)
