# Meta User Profile API findings

## Messenger
Source: https://developers.facebook.com/documentation/business-messaging/messenger-platform/identity/user-profile
Updated: March 18, 2026.

Meta states that retrieving a Messenger user's profile by PSID requires Advanced Access for the Business Asset User Profile Access feature. The available fields include `name`, `first_name`, `last_name`, and `profile_pic`; some fields require additional permissions. Meta also states that a valid PSID can return an empty object when profile information is unavailable, including phone-number-created Messenger accounts.

The documented request is `GET /<PSID>?fields=first_name,last_name,profile_pic&access_token=<PAGE_ACCESS_TOKEN>`.

## Instagram
Source: https://developers.facebook.com/documentation/business-messaging/instagram-messaging/features/user-profile
Updated: April 1, 2026.

Meta states that user consent is required for Instagram profile lookup, together with `instagram_basic`, `instagram_manage_messages`, `pages_manage_metadata`, `pages_read_engagement`, and `pages_show_list`. Available fields include `name`, `profile_pic`, and `username`; name and profile picture can be null.

## Product implication
A generic contact label and missing avatar cannot be described as a completed identity feature when Graph returns an empty profile. The Inbox must display the best stored CRM/channel fallback and an honest availability notice. Meta Connections should expose the required Business Asset User Profile Access/App Review blocker for Messenger rather than silently retrying.
