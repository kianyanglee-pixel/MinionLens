from dotenv import load_dotenv

load_dotenv()

from flask import Flask
from flask_cors import CORS

from app.routes import bp

app = Flask(__name__)
CORS(app)
app.register_blueprint(bp)

if __name__ == "__main__":
    app.run(debug=True, port=5000)
