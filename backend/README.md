# Backend (FastAPI)

Run locally:

1. pip install -r requirements.txt
2. Copy `.env.example` to `.env` and fill `MONGO_URI`
3. uvicorn main:app --reload

Available endpoints:

- GET /products
- GET /product/{id}
- POST /login
- POST /signup
- POST /auth/google
