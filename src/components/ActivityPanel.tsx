import { Bot, Cpu, RotateCcw, UserRound } from "lucide-react";
import type { ReactNode } from "react";

import type { ActivityEvent } from "../domain/models";
import "../styles/timeline.css";

export interface ActivityPanelProps {
  activities: ActivityEvent[];
  activeAgentAction?: string;
  revertingActivityId?: string;
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
  activeAgentAction,
  revertingActivityId,
  maxItems = 30,
  onRevert,
  onSelectActivity,
}: ActivityPanelProps) {
  const visibleActivities = [...activities]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, maxItems);

  return (
    <aside className="activity-panel" aria-label="Case activity">
      <header className="activity-panel__header">
        <div>
          <h2>Activity</h2>
          <p>Human, agent, and system changes</p>
        </div>
        <span
          className="activity-panel__count"
          aria-label={`${String(activities.length)} recorded activities`}
        >
          {activities.length}
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

      {visibleActivities.length === 0 ? (
        <div className="activity-panel__empty">
          <Cpu size={17} aria-hidden="true" />
          <p>Changes to this case will appear here.</p>
        </div>
      ) : (
        <ol className="activity-list">
          {visibleActivities.map((activity) => {
            const identity = activityIdentity(activity);
            const canRevert = activity.author === "agent" && activity.undoable && Boolean(onRevert);
            const isReverting = revertingActivityId === activity.id;
            return (
              <li className={`activity-item activity-item--${activity.author}`} key={activity.id}>
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
                      <time dateTime={activity.createdAt}>
                        {formatActivityTime(activity.createdAt)}
                      </time>
                    </span>
                    <span className="activity-item__summary">{activity.summary}</span>
                    <span className="activity-item__version">Case v{activity.caseVersion}</span>
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
      )}
    </aside>
  );
}
