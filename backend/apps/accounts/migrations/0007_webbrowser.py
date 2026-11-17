import uuid
from django.db import migrations, models
import django.db.models.deletion

class Migration(migrations.Migration):
    dependencies = [('accounts', '0006_web_channel')]
    operations = [migrations.CreateModel(name='WebBrowser', fields=[
        ('credential_hash', models.CharField(max_length=64, primary_key=True, serialize=False)),
        ('public_id', models.UUIDField(default=uuid.uuid4, unique=True)),
        ('generation', models.PositiveBigIntegerField(default=0)),
        ('expires_at', models.DateTimeField(db_index=True)),
        ('device', models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, to='accounts.devicesession')),
        ('pending_attempt', models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, to='accounts.yandexattempt')),
    ])]
