"""Landing page view."""
from django.shortcuts import render


def landing_page(request):
    """Render the landing page."""
    return render(request, "dashboard/landing.html")
