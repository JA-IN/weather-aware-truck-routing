from rest_framework import serializers


class RouteAnalysisRequestSerializer(serializers.Serializer):
    origin = serializers.CharField(min_length=2, max_length=180)
    destination = serializers.CharField(min_length=2, max_length=180)
    departureIso = serializers.DateTimeField()
    loadWeightLbs = serializers.FloatField(min_value=0.01, max_value=200000)
    sampleMiles = serializers.ChoiceField(choices=[10, 25, 50])

    def validate_departureIso(self, value):
        # With settings.USE_TZ = False, DRF already normalizes an incoming
        # "...Z" / offset-aware timestamp into a naive UTC datetime here.
        # Re-serialize to an ISO string so downstream services get a
        # consistent plain string input regardless of client format.
        return value.isoformat()
