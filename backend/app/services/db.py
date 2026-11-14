"""UNCONFIRMED: MongoDB (Atlas). Hosting, collections, fields and the change
stream feeding SSE are all unconfirmed. Schema notes: database/README.md.

Intended (spec): pymongo async client; collections facts, strategies, people,
reviews, messages, events; an `events` change stream replaces the in-memory
log in app/events.py.
"""
from .. import config


def client():
    """UNCONFIRMED"""
    from pymongo import AsyncMongoClient  # optional dependency: pip install -e .[mongo]
    return AsyncMongoClient(config.MONGODB_URI)
