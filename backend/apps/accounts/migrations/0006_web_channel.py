from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('accounts', '0005_yandexattempt')]
    operations = [
        migrations.AddField(model_name='devicesession', name='channel', field=models.CharField(default='native', max_length=8)),
        migrations.AddField(model_name='yandexattempt', name='channel', field=models.CharField(default='native', max_length=8)),
    ]
