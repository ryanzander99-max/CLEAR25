#!/bin/bash
pip install -r webapp/requirements.txt
cd webapp && python manage.py migrate --noinput && python manage.py shell -c "from django.contrib.sites.models import Site; Site.objects.update_or_create(id=1, defaults={'domain': 'clear25.xyz', 'name': 'C.L.E.A.R.'})" && python manage.py collectstatic --noinput
