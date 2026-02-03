from django.urls import path, include

urlpatterns = [
    path("accounts/", include("allauth.urls")),
    path("", include("dashboard.urls")),
]
