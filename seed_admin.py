#!/usr/bin/env python3
"""
Seed a super admin user into the  database.
Usage: python seed_admin.py <DATABASE_URL>
"""
import sys, uuid

try:
    import psycopg2
    from passlib.context import CryptContext
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install",
                          "psycopg2-binary", "passlib[bcrypt]"])
    import psycopg2
    from passlib.context import CryptContext

if len(sys.argv) < 2:
    print("Usage: python seed_admin.py <DATABASE_URL>")
    sys.exit(1)

DB_URL = sys.argv[1]

# Admin details — change these
FULL_NAME = input("Full name [Emmanuel Otieno]: ").strip() or "Emmanuel Otieno"
EMAIL     = input("Email [otienoemmanuel683@gmail.com]: ").strip() or "otienoemmanuel683@gmail.com"
PASSWORD  = input("Password: ").strip()

if not PASSWORD:
    print("Password cannot be empty")
    sys.exit(1)

# Hash the password
pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")
hashed  = pwd_ctx.hash(PASSWORD)
user_id = str(uuid.uuid4())

print(f"\nCreating admin:")
print(f"  Name:  {FULL_NAME}")
print(f"  Email: {EMAIL}")
print(f"  ID:    {user_id}")

conn = psycopg2.connect(DB_URL)
conn.autocommit = False
cur  = conn.cursor()

try:
    # Check if user already exists
    cur.execute("SELECT id FROM users WHERE email = %s", (EMAIL,))
    existing = cur.fetchone()

    if existing:
        user_id = existing[0]
        print(f"\n  User already exists (id: {user_id}) — updating password and role")
        cur.execute(
            "UPDATE users SET hashed_password = %s, full_name = %s, is_active = true WHERE email = %s",
            (hashed, FULL_NAME, EMAIL)
        )
    else:
        # Create user
        cur.execute("""
            INSERT INTO users (id, email, full_name, hashed_password, is_active, created_at, updated_at)
            VALUES (%s, %s, %s, %s, true, NOW(), NOW())
        """, (user_id, EMAIL, FULL_NAME, hashed))

    # Assign org_admin role — check table name first
    cur.execute("""
        SELECT tablename FROM pg_tables 
        WHERE schemaname='public' AND tablename IN ('user_roles','user_role_assignments')
    """)
    role_table = cur.fetchone()
    if not role_table:
        print("ERROR: Could not find user roles table")
        conn.rollback()
        sys.exit(1)

    role_table = role_table[0]
    print(f"  Using roles table: {role_table}")

    # Remove existing roles for this user
    cur.execute(f"DELETE FROM {role_table} WHERE user_id = %s", (user_id,))

    # Add org_admin role
    cur.execute(f"""
        INSERT INTO {role_table} (id, user_id, role, created_at)
        VALUES (%s, %s, 'org_admin', NOW())
    """, (str(uuid.uuid4()), user_id))

    conn.commit()
    print(f"\n✓ Super admin created successfully!")
    print(f"  Email:    {EMAIL}")
    print(f"  Password: (as entered)")
    print(f"  Role:     org_admin")
    print(f"\n  Login at: https://data-extraction-platform.vercel.app")

except Exception as e:
    conn.rollback()
    print(f"\n✗ Error: {e}")
    import traceback; traceback.print_exc()
finally:
    cur.close()
    conn.close()
