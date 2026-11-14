"""Tests run against a SEPARATE database (inlook_test) and the in-memory event log, never the demo data.

Set before app.config is imported anywhere: the seed script clears every collection in the configured database.
"""
import os

os.environ["MONGODB_DB"] = "inlook_test"
os.environ["INLOOK_EVENTS"] = "memory"
