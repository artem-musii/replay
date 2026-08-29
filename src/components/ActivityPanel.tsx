import { Bot, Cpu, RotateCcw, UserRound } from "lucide-react";
import type { ReactNode } from "react";

import type { ActivityEvent } from "../domain/models";
import "../styles/timeline.css";

export interface ActivityPanelProps {
  activities: ActivityEvent[];
  sessionActivities?: ActivityEvent[];
  activeAgentAction?: string;
  revertingActivityId?: string;
  revertibleActivityIds?: readonly string[];
  maxItems?: number;
  onRevert?: (activityId: string) => void;
  onSelectActivity?: (activity: ActivityEvent) => void;
}

function activityIdentity(activity: ActivityEvent): {
  icon: ReactNode;
  name: string;
  detail: string;
} {
  if (activity.author === "agent") {
    return {
      icon: <Bot size={14} aria-hidden="true" />,
      name: "Agent",
      detail: activity.origin === "webmcp" ? "Site Tool" : "Workspace",
    };
  }
  if (activity.author === "human") {
    return {
      icon: <UserRound size={14} aria-hidden="true" />,
      name: "You",
      detail: activity.origin === "webmcp" ? "Site Tool" : "Workspace",
    };
  }
  return {
    icon: <Cpu size={14} aria-hidden="true" />,
    name: "System",
    detail: "Automatic",
  };
}

function formatActivityTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Time unavailable";
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

export function ActivityPanel({
  activities,
  sessionActivities = [],
  activeAgentAction,
  revertingActivityId,
  revertibleActivityIds = [],
  maxItems = 30,
  onRevert,
  onSelectActivity,
}: ActivityPanelProps) {
  const visibleActivities = [...activities]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, maxItems);
  const visibleSessionActivities = [...sessionActivities]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, maxItems);
  const revertibleActivityIdSet = new Set(revertibleActivityIds);
  const totalActivities = activities.length + sessionActivities.length;

  function renderActivityList(items: ActivityEvent[], sessionOnly: boolean) {
    return (
      <ol
        className="activity-list"
        aria-label={sessionOnly ? "Session-only Site Tool calls" : "Durable case changes"}
      >
        {items.map((activity) => {
          const identity = activityIdentity(activity);
          const canRevert =
            !sessionOnly &&
            activity.author === "agent" &&
            activity.undoable &&
            revertibleActivityIdSet.has(activity.id) &&
            Boolean(onRevert);
          const isReverting = revertingActivityId === activity.id;
          return (
            <li
              className={`activity-item activity-item--${activity.author}${sessionOnly ? " activity-item--session" : ""}`}
              key={activity.id}
            >
              <button
                className="activity-item__body"
                type="button"
                onClick={() => onSelectActivity?.(activity)}
                disabled={!onSelectActivity}
              >
                <span className="activity-item__identity" aria-hidden="true">
                  {identity.icon}
                </span>
                <span className="activity-item__content">
                  <span className="activity-item__meta">
                    <strong>{identity.name}</strong>
                    <span>{identity.detail}</span>
                    {sessionOnly && (
                      <span className="activity-item__session-label">Session only</span>
                    )}
                    {activity.classification === "human-override" && (
                      <span className="activity-item__classification">Human override</span>
                    )}
                    <time dateTime={activity.createdAt}>
                      {formatActivityTime(activity.createdAt)}
                    </time>
                  </span>
                  <span className="activity-item__summary">{activity.summary}</span>
                  <span className="activity-item__trace">
                    <span>
                      {sessionOnly
                        ? `No case change · observed v${String(activity.caseVersion)}`
                        : `Case v${String(activity.caseVersion)}`}
                    </span>
                    {activity.requestId && <code>Request {activity.requestId}</code>}
                    {activity.overridesActivityId && (
                      <code>Overrides {activity.overridesActivityId}</code>
                    )}
                  </span>
                </span>
              </button>
              {canRevert && (
                <button
                  className="activity-item__revert"
                  type="button"
                  onClick={() => onRevert?.(activity.id)}
                  disabled={isReverting}
                  aria-label={`Revert agent action: ${activity.summary}`}
                >
                  <RotateCcw size={12} aria-hidden="true" />
                  {isReverting ? "Reverting" : "Revert"}
                </button>
              )}
            </li>
          );
        })}
      </ol>
    );
  }

  return (
    <aside className="activity-panel" aria-label="Case activity">
      <header className="activity-panel__header">
        <div>
          <h2>Activity</h2>
          <p>Case changes and session tool calls</p>
        </div>
        <span className="activity-panel__count">
          <span aria-hidden="true">{totalActivities}</span>
          <span className="visually-hidden">
            {activities.length} case {activities.length === 1 ? "change" : "changes"} and{" "}
            {sessionActivities.length} session {sessionActivities.length === 1 ? "call" : "calls"}
          </span>
        </span>
      </header>

      {activeAgentAction && (
        <div className="activity-live" role="status" aria-live="polite">
          <span className="activity-live__pulse" aria-hidden="true" />
          <Bot size={14} aria-hidden="true" />
          <div>
            <strong>Agent working</strong>
            <span>{activeAgentAction}</span>
          </div>
        </div>
      )}

      {visibleActivities.length === 0 && visibleSessionActivities.length === 0 ? (
        <div className="activity-panel__empty">
          <Cpu size={17} aria-hidden="true" />
          <p>Changes to this case will appear here.</p>
        </div>
      ) : (
        <div className="activity-lanes">
          <section className="activity-lane" aria-label="Case changes">
            <header className="activity-lane__header">
              <strong>Case changes</strong>
              <span>{activities.length}</span>
            </header>
            {visibleActivities.length > 0 ? (
              renderActivityList(visibleActivities, false)
            ) : (
              <p className="activity-lane__empty">No case changes yet.</p>
            )}
          </section>
          {visibleSessionActivities.length > 0 && (
            <section className="activity-lane activity-lane--session" aria-label="Site Tool calls">
              <header className="activity-lane__header">
                <strong>Site Tool calls</strong>
                <span>Session only · {sessionActivities.length}</span>
              </header>
              {renderActivityList(visibleSessionActivities, true)}
            </section>
          )}
        </div>
      )}
    </aside>
  );
}
