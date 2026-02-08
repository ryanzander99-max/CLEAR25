"""Landing page view."""
from django.shortcuts import render


def landing_page(request):
    """Render the landing page."""
    return render(request, "dashboard/landing.html")


def privacy_page(request):
    """Render the privacy policy page."""
    return render(request, "dashboard/privacy.html")
