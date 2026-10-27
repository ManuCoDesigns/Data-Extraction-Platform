"""Topic and client-side answerer on client questions.

Revision ID: 034_question_topics
Revises: 033_source_observations
"""
from alembic import op
import sqlalchemy as sa

revision = '034_question_topics'
down_revision = '033_source_observations'


def upgrade():
    cols = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("client_questions")}
    if "topic" not in cols:
        op.add_column("client_questions", sa.Column("topic", sa.String(40), nullable=True))
    if "answered_by_name" not in cols:
        op.add_column("client_questions", sa.Column("answered_by_name", sa.String(160), nullable=True))


def downgrade():
    op.drop_column("client_questions", "answered_by_name")
    op.drop_column("client_questions", "topic")
