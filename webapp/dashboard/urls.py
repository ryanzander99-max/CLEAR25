from django.urls import path
from . import views

urlpatterns = [
    path("", views.index, name="index"),
    path("api/stations/", views.api_stations),
    path("api/demo/", views.api_demo),
    path("api/fetch/", views.api_fetch),
]
