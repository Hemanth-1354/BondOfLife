# Backend AWS services wrapper

import os
from typing import Any, Dict, List, Optional
import boto3
from botocore.exceptions import ClientError
from datetime import datetime

# Load environment variables (AWS credentials, region, etc.)
AWS_REGION = os.getenv("AWS_REGION", "us-east-1")

# DynamoDB client
_dynamo = boto3.resource("dynamodb", region_name=AWS_REGION)

# Table names (should match what you create in AWS)
TABLE_DONORS = os.getenv("TABLE_DONORS", "BondOfLife-Donors")
TABLE_REQUESTS = os.getenv("TABLE_REQUESTS", "BondOfLife-Requests")
TABLE_CONVERSATIONS = os.getenv("TABLE_CONVERSATIONS", "BondOfLife-Conversations")
TABLE_LEARNED = os.getenv("TABLE_LEARNED", "BondOfLife-LearnedPatterns")

# S3 client (for static assets / dataset)
_s3 = boto3.client("s3", region_name=AWS_REGION)

# SES client (for email notifications)
_ses = boto3.client("ses", region_name=AWS_REGION)

# Bedrock client – using Claude 3 Haiku (cheapest model)
# If AWS credentials are missing, fallback to a local stub that writes to a file.

def _bedrock_client():
    try:
        return boto3.client("bedrock-runtime", region_name=AWS_REGION)
    except Exception:
        return None

_bedrock = _bedrock_client()

# ---------- DynamoDB helpers ----------

def get_table(name: str):
    return _dynamo.Table(name)

def put_item(table_name: str, item: Dict[str, Any]):
    table = get_table(table_name)
    table.put_item(Item=item)

def get_item(table_name: str, key: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    table = get_table(table_name)
    resp = table.get_item(Key=key)
    return resp.get("Item")

def query_items(table_name: str, **kwargs):
    table = get_table(table_name)
    return table.query(**kwargs)

# ---------- S3 ----------
def upload_file(bucket: str, key: str, file_path: str):
    _s3.upload_file(Filename=file_path, Bucket=bucket, Key=key)

def download_file(bucket: str, key: str, dest_path: str):
    _s3.download_file(Bucket=bucket, Key=key, Filename=dest_path)

# ---------- SES ----------
def send_email(to_address: str, subject: str, body_html: str, body_text: str = ""):
    try:
        response = _ses.send_email(
            Source=os.getenv("SES_SOURCE_EMAIL"),
            Destination={"ToAddresses": [to_address]},
            Message={
                "Subject": {"Data": subject, "Charset": "UTF-8"},
                "Body": {
                    "Html": {"Data": body_html, "Charset": "UTF-8"},
                    "Text": {"Data": body_text or subject, "Charset": "UTF-8"},
                },
            },
        )
        return response
    except ClientError:
        # Local fallback – write to a file for simulation
        fallback_dir = os.path.abspath("local_emulator/sent_emails")
        os.makedirs(fallback_dir, exist_ok=True)
        timestamp = datetime.utcnow().isoformat()
        filename = os.path.join(fallback_dir, f"{timestamp}_{to_address}.txt")
        with open(filename, "w", encoding="utf-8") as f:
            f.write(f"Subject: {subject}\n\n{body_html}")
        return {"Simulation": True, "File": filename}

# ---------- Bedrock ----------
def invoke_claude(prompt: str) -> str:
    if _bedrock:
        try:
            body = {
                "prompt": prompt,
                "max_tokens": 500,
                "temperature": 0.7,
                "anthropic_version": "bedrock-2023-05-31",
            }
            response = _bedrock.invoke_model(
                modelId="anthropic.claude-3-haiku-20240307-v1:0",
                body=bytes(str(body), "utf-8"),
                contentType="application/json",
                accept="application/json",
            )
            return response.get("body", b"").decode("utf-8")
        except Exception:
            pass
    # Local fallback – simple echo
    return f"[LocalStub] {prompt}"

# Exported symbols for other modules
__all__ = [
    "put_item",
    "get_item",
    "query_items",
    "upload_file",
    "download_file",
    "send_email",
    "invoke_claude",
    "TABLE_DONORS",
    "TABLE_REQUESTS",
    "TABLE_CONVERSATIONS",
    "TABLE_LEARNED",
]
