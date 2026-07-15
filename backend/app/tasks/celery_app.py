from celery import Celery
from app.core.config import settings

celery_app = Celery(
    "",
    broker=settings.CELERY_BROKER_URL,
    backend=settings.CELERY_RESULT_BACKEND,
    include=["app.tasks.extraction", "app.tasks.llm_review"],
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    task_routes={
        "app.tasks.extraction.*": {"queue": "extraction"},
        "app.tasks.llm_review.*": {"queue": "llm"},
    },
)
