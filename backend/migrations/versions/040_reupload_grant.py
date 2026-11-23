"""An admin can open a source for one re-upload by its extractor.

Revision ID: 040_reupload_grant
Revises: 039_trace_flag
"""
from alembic import op
import sqlalchemy as sa

revision = '040_reupload_grant'
down_revision = '039_trace_flag'


def upgrade():
    insp = sa.inspect(op.get_bind())
    cols = [c["name"] for c in insp.get_columns("sources")]
    if "reupload_until" not in cols:
        op.add_column("sources", sa.Column("reupload_until", sa.DateTime(timezone=True), nullable=True))
    if "reupload_by" not in cols:
        op.add_column("sources", sa.Column("reupload_by", sa.String(36), nullable=True))
    if "reupload_note" not in cols:
        op.add_column("sources", sa.Column("reupload_note", sa.String(300), nullable=True))


def downgrade():
    for c in ("reupload_note", "reupload_by", "reupload_until"):
        op.drop_column("sources", c)
