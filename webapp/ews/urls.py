from django.urls import path, include

urlpatterns = [
    path("", include("dashboard.urls")),
    path("accounts/", include("allauth.urls")),
]
