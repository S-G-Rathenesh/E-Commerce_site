import urllib.request
import json

url = "http://127.0.0.1:8000/signup"
headers = {'Content-Type': 'application/json'}

def create_user(email, password, role, phone_number, full_name, pincode=None):
    data = {
        "email": email,
        "password": password,
        "role": role,
        "phone_number": phone_number,
        "full_name": full_name
    }
    if pincode:
        data["pincode"] = pincode
        
    req = urllib.request.Request(url, data=json.dumps(data).encode('utf-8'), headers=headers, method='POST')
    try:
        response = urllib.request.urlopen(req)
        print(f"Created {email}: {response.getcode()}")
    except urllib.error.HTTPError as e:
        print(f"Failed {email}: {e.code} {e.read().decode()}")

create_user("delivery@test.com", "password123", "DELIVERY_ASSOCIATE", "9876543210", "Delivery Agent", "600001")
create_user("admin@test.com", "password123", "ADMIN", "9876543211", "System Admin")
create_user("customer@test.com", "password123", "CUSTOMER", "9876543212", "John Customer")
