# backend/tests/conftest.py
"""Pytest configuration for backend tests."""

import pytest


def pytest_configure(config):
    """Register custom markers."""
    config.addinivalue_line(
        "markers",
        "slow: marks tests as slow (may require loading large models)"
    )
