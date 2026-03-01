import iris
import time
import os

username = 'demo'
password = 'demo'
hostname = os.getenv('IRIS_HOSTNAME', 'localhost')
port = '1972' 
namespace = 'USER'
CONNECTION_STRING = f"{hostname}:{port}/{namespace}"
print(CONNECTION_STRING)
conn = iris.connect(CONNECTION_STRING, username, password)
cursor = conn.cursor()