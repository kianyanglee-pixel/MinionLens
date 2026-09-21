from dotenv import load_dotenv

load_dotenv()

from flask import Flask
from flask_cors import CORS
from app.routes import bp

app = Flask(__name__)

# 1. Allow up to 500MB payload for zip batches and documents
app.config['MAX_CONTENT_LENGTH'] = 500 * 1024 * 1024

# 2. Enable CORS across all origins
CORS(app, resources={r"/*": {"origins": "*"}})

# 3. Explicitly set url_prefix="/api" here to guarantee the /api prefix
app.register_blueprint(bp, url_prefix="/api")

if __name__ == "__main__":
    # Bind to 0.0.0.0 so both 127.0.0.1 and localhost connect cleanly
    app.run(debug=True, host="0.0.0.0", port=5000)