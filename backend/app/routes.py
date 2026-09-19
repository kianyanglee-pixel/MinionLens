from flask import Blueprint, jsonify

from loader import Inbox

bp = Blueprint("api", __name__, url_prefix="/api")


@bp.route("/hello")
def hello():
    return jsonify(message="Hello from Flask!")


@bp.route("/emails")
def list_emails():
    inbox = Inbox("supabase")
    return jsonify(inbox.emails())


@bp.route("/emails/<email_id>")
def get_email(email_id):
    inbox = Inbox("supabase")
    return jsonify(inbox.get(email_id))
