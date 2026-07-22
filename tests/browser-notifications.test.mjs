import assert from "node:assert/strict";
import test from "node:test";
import {
  browserNotificationDestination,
  mergeBrowserNotificationIds,
  parseBrowserAlertPreference,
  unseenBrowserNotifications,
} from "../src/lib/browser-notifications.ts";

const notifications = [
  { id: "one", kind: "Account", title: "One", body: "First", createdAt: "2026-07-22T10:00:00.000Z" },
  { id: "two", kind: "Market", title: "Two", body: "Second", marketId: "gate a", createdAt: "2026-07-22T10:01:00.000Z" },
];

test("browser alert preferences fail closed when storage is invalid", () => {
  assert.deepEqual(parseBrowserAlertPreference(null), { enabled: false, seenIds: [] });
  assert.deepEqual(parseBrowserAlertPreference("not-json"), { enabled: false, seenIds: [] });
  assert.deepEqual(parseBrowserAlertPreference('{"enabled":"yes","seenIds":[]}'), { enabled: false, seenIds: [] });
});

test("browser alert preferences deduplicate valid notification identifiers", () => {
  assert.deepEqual(parseBrowserAlertPreference('{"enabled":true,"seenIds":["one","one",2,"two"]}'), {
    enabled: true,
    seenIds: ["one", "two"],
  });
});

test("unseen notifications and merged identifiers stay deterministic", () => {
  assert.deepEqual(unseenBrowserNotifications(notifications, ["one"]).map((item) => item.id), ["two"]);
  assert.deepEqual(mergeBrowserNotificationIds(["one"], notifications), ["one", "two"]);
});

test("notification destinations preserve market context", () => {
  assert.equal(browserNotificationDestination(notifications[0]), "/notifications");
  assert.equal(browserNotificationDestination(notifications[1]), "/markets/gate%20a");
});
