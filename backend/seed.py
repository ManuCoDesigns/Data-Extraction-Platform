#!/usr/bin/env python3
"""
Seed script — creates the first Org Admin user.
Run once after applying migrations:
  python seed.py --email admin@xtrium.ai --name "Xtrium Admin" --password yourpassword
"""
import argparse
from app.db.session import SessionLocal
from app.models.all_models import User, UserRoleAssignment, UserRole
from app.core.security import hash_password


def seed(email: str, name: str, password: str):
    db = SessionLocal()
    try:
        existing = db.query(User).filter(User.email == email).first()
        if existing:
            print(f"User {email} already exists.")
            return

        user = User(email=email, full_name=name, hashed_password=hash_password(password))
        db.add(user)
        db.flush()
        db.add(UserRoleAssignment(user_id=user.id, role=UserRole.ORG_ADMIN))
        db.commit()
        print(f"✓ Created Org Admin: {email}")
    finally:
        db.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--email", required=True)
    parser.add_argument("--name", required=True)
    parser.add_argument("--password", required=True)
    args = parser.parse_args()
    seed(args.email, args.name, args.password)
