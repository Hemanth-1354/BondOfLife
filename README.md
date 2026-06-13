# BondOfLife

A lightweight AI-enabled blood donation coordination project built for emergency and routine blood request matching.

## What it is

- Backend: FastAPI service with donor matching, request intake, outreach tracking, and AWS service wrappers.
- Frontend: React + Vite UI for managing donors, requests, and status.

## Key files

- `main.py`: FastAPI app defining request and donor APIs.
- `matching_engine.py`: Donor scoring, request creation, and SLA escalation logic.
- `backend/aws_services.py`: AWS wrappers for DynamoDB, SES, S3, and Bedrock AI calls.
- `Dataset.csv`: Seed data used to populate donor records.
- `frontend/`: React frontend app powered by Vite.

## Setup

1. Install backend dependencies:
   ```bash
   pip install -r requirements.txt
   pip install -r backend/requirements.txt
   ```
2. Start backend:
   ```bash
   uvicorn main:app --reload
   ```
3. Start frontend:
   ```bash
   cd frontend
   npm install
   npm run dev
   ```

## Notes

- The backend currently uses AWS wrappers and local fallbacks for email and AI when credentials are not configured.
- The repo is designed for quick prototyping and hackathon demo use.
