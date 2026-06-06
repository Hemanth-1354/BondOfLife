# Backend AWS services wrapper

import os
import logging
import json
from typing import Any, Dict, List, Optional
import boto3
from botocore.exceptions import ClientError
from datetime import datetime

# Setup logger
logger = logging.getLogger("aws_services")
logger.setLevel(logging.INFO)

# Load environment variables (AWS credentials, region, etc.)
AWS_REGION = os.getenv("AWS_REGION", "us-east-1")

# Attempt to create DynamoDB resource; fallback to in‑memory stub if credentials are missing
try:
    _dynamo = boto3.resource("dynamodb", region_name=AWS_REGION)
    # Verify credentials; if unavailable, fallback to stub
    try:
        _dynamo.meta.client.list_tables()
    except Exception:
        _dynamo = None
        logger.warning("AWS credentials not found – using in‑memory DynamoDB stub.")
except Exception:
    _dynamo = None
    logger.warning("AWS credentials not found – using in‑memory DynamoDB stub.")

# In‑memory stub structures (used when _dynamo is None)
_in_memory_db: Dict[str, Dict[str, Dict[str, Any]]] = {}

# Table names (should match what you create in AWS)
TABLE_DONORS = os.getenv("TABLE_DONORS", "BondOfLife-Donors")
TABLE_REQUESTS = os.getenv("TABLE_REQUESTS", "BondOfLife-Requests")
TABLE_CONVERSATIONS = os.getenv("TABLE_CONVERSATIONS", "BondOfLife-Conversations")
TABLE_LEARNED = os.getenv("TABLE_LEARNED", "BondOfLife-LearnedPatterns")

# S3 client (for static assets / dataset)
_s3 = None
try:
    _s3 = boto3.client("s3", region_name=AWS_REGION)
except Exception:
    logger.warning("AWS credentials not found – S3 client unavailable.")

# SES client (for email notifications)
_ses = None
try:
    _ses = boto3.client("ses", region_name=AWS_REGION)
except Exception:
    logger.warning("AWS credentials not found – SES client unavailable.")

# Bedrock client – using Claude 3 Haiku (cheapest model)
# If AWS credentials are missing, fallback to a local stub that writes to a file.

def _bedrock_client():
    try:
        import boto3
        return boto3.client("bedrock-runtime", region_name=AWS_REGION)
    except Exception:
        return None

_bedrock = _bedrock_client()

# ---------- DynamoDB helpers ----------

def get_table(name: str):
    if _dynamo is None:
        # Return a simple stub object with expected methods for in‑memory use
        class StubTable:
            def __init__(self, table_name: str):
                self.name = table_name

            def put_item(self, Item: Dict[str, Any]):
                _in_memory_db.setdefault(self.name, {})[Item["user_id"]] = Item

            def get_item(self, Key: Dict[str, Any]):
                # Assume the primary key is 'user_id' or similar
                key_name = next(iter(Key))
                key_val = Key[key_name]
                return _in_memory_db.get(self.name, {}).get(key_val)

            def scan(self):
                return {"Items": list(_in_memory_db.get(self.name, {}).values())}
        return StubTable(name)
    return _dynamo.Table(name)

# Load local fallback data for DynamoDB
_local_db_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".local_dynamodb.json"))
try:
    with open(_local_db_path, "r", encoding="utf-8") as f:
        _local_db = json.load(f)
except Exception:
    _local_db = {}

def _save_local_db():
    with open(_local_db_path, "w", encoding="utf-8") as f:
        json.dump(_local_db, f, indent=2)

def put_item(table_name: str, item: Dict[str, Any]):
    try:
        table = get_table(table_name)
        table.put_item(Item=item)
    except Exception:
        # Fallback to local JSON store
        if table_name not in _local_db:
            _local_db[table_name] = {}
        key = item.get("user_id") or item.get("donor_id") or item.get("request_id") or str(len(_local_db[table_name]))
        _local_db[table_name][key] = item
        _save_local_db()

def get_item(table_name: str, key: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    try:
        table = get_table(table_name)
        resp = table.get_item(Key=key)
        return resp.get("Item")
    except Exception:
        # Fallback
        table = _local_db.get(table_name, {})
        # Assume key dict has a single key
        key_name = next(iter(key))
        key_val = key[key_name]
        return table.get(key_val)

def query_items(table_name: str, **kwargs):
    table = get_table(table_name)
    return table.query(**kwargs)

# ---------- S3 ----------
def upload_file(bucket: str, key: str, file_path: str):
    if _s3:
        _s3.upload_file(Filename=file_path, Bucket=bucket, Key=key)
    else:
        logger.info(f"Simulated upload of {file_path} to s3://{bucket}/{key}")

def download_file(bucket: str, key: str, dest_path: str):
    if _s3:
        _s3.download_file(Bucket=bucket, Key=key, Filename=dest_path)
    else:
        logger.info(f"Simulated download from s3://{bucket}/{key} to {dest_path}")

# ---------- SES ----------
def send_email(to_address: str, subject: str, body_html: str, body_text: str = ""):
    if _ses:
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
        except ClientError as e:
            logger.error(f"SES send_email error: {e}")
    # Fallback simulation
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

# Compatibility wrappers expected by main.py

def db_get_item(table_name: str, key: dict):
    """Wrapper for get_item used in existing codebase."""
    return get_item(table_name, key)

def db_put_item(table_name: str, key: str, item: dict):
    """Wrapper for put_item. 'key' is redundant; kept for signature compatibility."""
    # In original code, db_put_item(table, id, data). We ignore key and just put item.
    return put_item(table_name, item)

def db_scan_table(table_name: str):
    """Simple scan of entire DynamoDB table (or local fallback).
    Returns list of items.
    """
    try:
        table = get_table(table_name)
        response = table.scan()
        return response.get('Items', [])
    except Exception:
        # Fallback to local JSON
        return list(_local_db.get(table_name, {}).values())

def ses_send_email(to_address: str, subject: str, body_html: str, body_text: str = ""):
    """Alias to send_email for legacy name."""
    return send_email(to_address, subject, body_html, body_text)

def query_bedrock(prompt: str, system_prompt: str = "") -> str:
    """Alias to invoke_claude used by matching engine.
    Accepts optional system_prompt which is prefixed to the prompt.
    """
    full_prompt = f"{system_prompt}\n{prompt}" if system_prompt else prompt
    return invoke_claude(full_prompt)

def get_email_logs():
    """Read simulated email logs from local fallback directory.
    Returns list of dicts with filename and content.
    """
    import glob, json
    fallback_dir = os.path.abspath("local_emulator/sent_emails")
    if not os.path.isdir(fallback_dir):
        return []
    logs = []
    for path in glob.glob(os.path.join(fallback_dir, "*.txt")):
        with open(path, "r", encoding="utf-8") as f:
            logs.append({"file": os.path.basename(path), "content": f.read()})
    return logs

# Exported symbols for other modules
__all__ = [
    "put_item",
    "get_item",
    "query_items",
    "upload_file",
    "download_file",
    "send_email",
    "invoke_claude",
    "db_get_item",
    "db_put_item",
    "db_scan_table",
    "ses_send_email",
    "query_bedrock",
    "get_email_logs",
    "TABLE_DONORS",
    "TABLE_REQUESTS",
    "TABLE_CONVERSATIONS",
    "TABLE_LEARNED",
]
