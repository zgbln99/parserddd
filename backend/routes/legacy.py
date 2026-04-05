"""
Legacy Blueprint — backward-compatible routes from the old portal.
"""

from flask import Blueprint

from auth.decorators import login_required

bp = Blueprint('legacy', __name__)


@bp.route('/portal/drivers')
@login_required
def portal_drivers():
    from routes.drivers import api_drivers
    return api_drivers()


@bp.route('/portal/download')
@login_required
def portal_download():
    from routes.analysis import api_analyze_dropbox
    return api_analyze_dropbox()


@bp.route('/portal/sync-status')
@login_required
def portal_sync_status():
    from routes.sync import api_sync_status
    return api_sync_status()


@bp.route('/portal/sync-log')
@login_required
def portal_sync_log():
    from routes.sync import api_sync_log
    return api_sync_log()


@bp.route('/upload', methods=['POST'])
@login_required
def upload():
    from routes.analysis import api_analyze_upload
    return api_analyze_upload()
