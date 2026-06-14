# email-agent-server/lib/gmail_labels.py
import logging
from typing import Dict, Optional
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

logger = logging.getLogger("gmail_labels")


def get_gmail_service(creds):
    """
    Builds and returns an authorized synchronous Google Gmail API service instance.
    """
    return build("gmail", "v1", credentials=creds)


def ensure_omnimind_labels(creds) -> Dict[str, str]:
    """
    Discovers or provisions the necessary nested Gmail labels on the user's account.
    Ensures 'OmniMind/Attention' and 'OmniMind/Processed' exist.
    
    Returns:
        A dictionary mapping the label names to their immutable Gmail label IDs.
        Example: {"OmniMind/Attention": "Label_1", "OmniMind/Processed": "Label_2"}
    """
    try:
        service = get_gmail_service(creds)
        
        # 1. Fetch all existing labels for the authenticated user
        results = service.users().labels().list(userId="me").execute()
        existing_labels = results.get("labels", [])

        label_map: Dict[str, str] = {}
        target_labels = ["OmniMind/Attention", "OmniMind/Processed"]

        # Check if they are already provisioned
        for label in existing_labels:
            if label["name"] in target_labels:
                label_map[label["name"]] = label["id"]

        # 2. Provision missing labels sequentially
        for target in target_labels:
            if target not in label_map:
                logger.info(f"Label '{target}' not found. Provisioning directly via Gmail API...")
                
                label_body = {
                    "name": target,
                    "labelListVisibility": "labelShow",
                    "messageListVisibility": "show",
                }
                
                try:
                    created_label = service.users().labels().create(userId="me", body=label_body).execute()
                    label_map[target] = created_label["id"]
                    logger.info(f"Successfully created label: {target} (ID: {created_label['id']})")
                except HttpError as http_err:
                    # Guard against a rare race condition where the label was created concurrently
                    if http_err.resp.status == 409:
                        logger.warning(f"Label '{target}' was created concurrently by another worker thread.")
                        # Re-fetch or fall back gracefully
                        updated_results = service.users().labels().list(userId="me").execute()
                        for lbl in updated_results.get("labels", []):
                            if lbl["name"] == target:
                                label_map[target] = lbl["id"]
                    else:
                        raise http_err

        return label_map

    except Exception as e:
        logger.error(f"Failed to verify or provision OmniMind system labels: {str(e)}")
        raise e


def list_all_user_labels(creds) -> Optional[list]:
    """
    Utility helper to inspect and return all plain metadata labels available 
    on the target Gmail account profile.
    """
    try:
        service = get_gmail_service(creds)
        results = service.users().labels().list(userId="me").execute()
        return results.get("labels", [])
    except Exception as e:
        logger.error(f"Failed to query Gmail labels list: {str(e)}")
        return None