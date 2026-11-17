"""PostgreSQL persistence for uploads, articles, and evaluations."""

from db.articles import (
    get_article,
    list_articles,
    upsert_articles_from_payload,
)
from db.connection import (
    database_label,
    get_connection,
    get_database_url,
    init_db,
)
from db.documents import (
    create_document,
    get_document,
    list_documents,
    update_document_progress,
    update_document_status,
)
from db.evaluations import (
    claim_evaluation_processing,
    get_document_evaluation_summary,
    get_evaluation,
    list_article_reviews,
    list_document_evaluations,
    list_pending_articles,
    list_recent_corrections,
    mark_evaluation_processing,
    save_evaluation_error,
    save_evaluation_result,
    upsert_evaluation,
)

__all__ = [
    "create_document",
    "database_label",
    "get_article",
    "get_connection",
    "get_database_url",
    "get_document",
    "get_document_evaluation_summary",
    "get_evaluation",
    "init_db",
    "list_articles",
    "claim_evaluation_processing",
    "list_article_reviews",
    "list_recent_corrections",
    "list_document_evaluations",
    "list_documents",
    "list_pending_articles",
    "mark_evaluation_processing",
    "save_evaluation_error",
    "save_evaluation_result",
    "update_document_progress",
    "update_document_status",
    "upsert_articles_from_payload",
    "upsert_evaluation",
]
