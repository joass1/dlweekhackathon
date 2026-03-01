# app/database/iris_client.py

import iris
import time
import os
from dotenv import load_dotenv

load_dotenv()

def get_iris_connection():
    username = 'demo'
    password = 'demo'
    hostname = os.getenv('IRIS_HOSTNAME', 'localhost')
    port = '1972'
    namespace = 'USER'
    
    CONNECTION_STRING = f"{hostname}:{port}/{namespace}"
    
    try:
        conn = iris.connect(CONNECTION_STRING, username, password)
        cursor = conn.cursor()
        return conn, cursor
    except Exception as e:
        print(f"Error connecting to IRIS: {e}")
        return None, None

# Create a function to ensure we always have a connection
def get_cursor():
    conn, cursor = get_iris_connection()
    if cursor is None:
        raise Exception("Could not connect to IRIS database")
    return cursor

# Optionally, create a connection pool or global connection if needed
_connection = None
def get_global_connection():
    global _connection
    if _connection is None:
        _connection, _ = get_iris_connection()
    return _connection