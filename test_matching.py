import os
import json
import pytest
from fastapi.testclient import TestClient
from main import app
from matching_engine import score_donors, haversine_distance, COMPATIBILITY_MAP

client = TestClient(app)

def test_haversine_distance():
    d = haversine_distance(17.3850, 78.4867, 17.4062, 78.4842)
    assert d > 0.0
    assert d < 5.0
    
    
    assert haversine_distance(None, 78.4867, 17.4062, 78.4842) == 999.0

def test_blood_compatibility():
    assert "O Positive" in COMPATIBILITY_MAP["O Positive"]
    assert "O Negative" in COMPATIBILITY_MAP["O Positive"]
    assert "A Positive" not in COMPATIBILITY_MAP["O Positive"]
    assert len(COMPATIBILITY_MAP["AB Positive"]) == 8

def test_scoring_and_ranking():
    results = score_donors("O Positive", 17.3850, 78.4867)
    assert len(results) >= 0
    if len(results) > 0:
        for i in range(len(results) - 1):
            assert results[i]["final_score"] >= results[i+1]["final_score"]

def test_api_endpoints():
    # Root check
    response = client.get("/")
    assert response.status_code == 200
    assert response.json()["status"] == "healthy"

    # Get donors
    response = client.get("/api/donors")
    assert response.status_code == 200
    donors = response.json()
    assert len(donors) > 0
    donor_id = donors[0]["user_id"]

    # Submit request
    payload = {
        "patient_id": "patient_test_99",
        "blood_group": "O Positive",
        "quantity": 1.0,
        "priority": "Emergency",
        "latitude": 17.3850,
        "longitude": 78.4867
    }
    response = client.post("/api/requests", json=payload)
    assert response.status_code == 200
    res_data = response.json()
    assert "request_id" in res_data
    req_id = res_data["request_id"]

    # Check outreach responds
    response = client.get(f"/api/outreach/respond?request_id={req_id}&donor_id={donor_id}&action=decline")
    assert response.status_code == 200
    assert response.json()["status"] == "success"

    # Verify fail learning logged
    response = client.get(f"/api/donors/{donor_id}")
    assert response.status_code == 200
    donor_profile = response.json()
    assert "learning_stats" in donor_profile
    assert donor_profile["learning_stats"]["total_declines"] > 0
