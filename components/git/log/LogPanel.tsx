"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useI18n } from "@/hooks/useI18n";
import type { CommitNode, GraphData, GraphLayoutResult } from "@/lib/git/types";
import { gitCommand, useGitMutation, useGitQuery, type GitTarget } from "../git-api";
import {
  GitErrorLine,
  GitIconButton,
  GitRowMenuButton,
  GitState,
  GitTabs,
  formatCommitTime,
  formatFullTime,
  useGitMenu,
  type GitMenuItem,
  type GitMenuState,
} from "../git-ui";
import { GitMenu } from "../git-ui";

/**
 * The commit graph and the commit list — Branchshift's Log surface.
 *
 * The geometry is Branchshift's `GitGraphSvg`: ten-pixel lanes, twenty-eight
 * pixel rows, and a line that runs vertical, then one row height of diagonal,
 * then vertical (the IntelliJ shape). The rows are windowed; the SVG is one
 * absolute layer behind them, so a thousand commits cost one scroll container.
 *
 * Paging is the ported page pipeline: the first read returns a lane snapshot,
 * and `loadMoreLog` continues the layout from it, so a lane that leaves the page
 * and comes back keeps its colour and column.
 */

const COLUMN_WIDTH = 10;
const ROW_HEIGHT = 28;
const GRAPH_PADDING = 6;
/**
 * The graph is as wide as the lanes the page has, up to a cap: a repository with
 * eighteen of them must show eighteen, and one that never branches must not
 * steal a hundred pixels from the subjects. Past the cap the graph is clipped
 * (the lanes are colours, and the colours repeat every eight), which is the
 * cheaper loss than a panel with no room left for a commit message.
 */
const GRAPH_MAX_WIDTH = 206;
/** A graph narrower than this says nothing: it is one lane and a sliver. */
const GRAPH_MIN_WIDTH = 36;
/** How much of the panel the graph may take. The subject is the reason to read
 *  the list, so on a phone the lanes give way to it and the drawing is clipped. */
const GRAPH_PANEL_FRACTION = 0.42;
const OVERSCAN_ROWS = 8;
// The graph's lane hues are CSS variables, so the palette lives in
// app/native-theme.css (with its light and dark sets) and this file draws with
// tokens, like the rest of the app.
const LANE_COLORS = [
  "var(--git-lane-1)",
  "var(--git-lane-2)",
  "var(--git-lane-3)",
  "var(--git-lane-4)",
  "var(--git-lane-5)",
  "var(--git-lane-6)",
  "var(--git-lane-7)",
  "var(--git-lane-8)",
];

const laneColor = (index: number) => LANE_COLORS[index % LANE_COLORS.length];
const colX = (column: number) => GRAPH_PADDING + column * COLUMN_WIDTH + COLUMN_WIDTH / 2;
const rowY = (row: number) => row * ROW_HEIGHT + ROW_HEIGHT / 2;

/** Vertical → one row of diagonal → vertical; a straight lane stays a line. */
function linePath(fromX: number, fromY: number, toX: number, toY: number, isStub = false): string {
  if (fromX === toX) return `M ${fromX} ${fromY} L ${toX} ${toY}`;
  if (isStub) return `M ${fromX} ${fromY} L ${toX} ${toY}`;
  const diagonalHeight = ROW_HEIGHT;
  const deltaY = toY - fromY;
  if (deltaY <= diagonalHeight) return `M ${fromX} ${fromY} L ${toX} ${toY}`;
  if (toX > fromX) {
    const diagonalEndY = fromY + diagonalHeight;
    return `M ${fromX} ${fromY} L ${toX} ${diagonalEndY} L ${toX} ${toY}`;
  }
  const diagonalStartY = toY - diagonalHeight;
  return `M ${fromX} ${fromY} L ${fromX} ${diagonalStartY} L ${toX} ${toY}`;
}

/** Follow a lane's parent chain to the first commit in the loaded window, so a
 *  filtered-out middle commit does not break the drawing. */
function resolveVisibleTarget(hash: string, visible: Set<string>, lanes: GraphData["lanes"]): string | null {
  let current = hash;
  const seen = new Set<string>();
  while (current && !visible.has(current)) {
    if (seen.has(current)) return null;
    seen.add(current);
    const lane = lanes[current];
    if (!lane || lane.lines.length === 0) return null;
    current = lane.lines[0].toCommit;
  }
  return visible.has(current) ? current : null;
}

interface GraphGeometry {
  lines: Array<{ key: string; d: string; color: string; isDashed: boolean; minY: number; maxY: number }>;
  nodes: Array<{ key: string; cx: number; cy: number; color: string; isMerge: boolean; isHead: boolean }>;
}

function buildGeometry(commits: CommitNode[], lanes: GraphData["lanes"]): GraphGeometry {
  const rowIndexByHash: Record<string, number> = {};
  commits.forEach((commit, index) => {
    rowIndexByHash[commit.hash] = index;
  });
  const visible = new Set(Object.keys(rowIndexByHash));
  const lines: GraphGeometry["lines"] = [];
  const nodes: GraphGeometry["nodes"] = [];

  for (const [index, commit] of commits.entries()) {
    const lane = lanes[commit.hash];
    if (!lane) continue;
    const color = laneColor(lane.color);
    const fromX = colX(lane.column);
    const fromY = rowY(index);
    nodes.push({
      key: commit.hash,
      cx: fromX,
      cy: fromY,
      color,
      isMerge: commit.parents.length > 1,
      isHead: commit.refs.some((ref) => ref.type === "HEAD"),
    });

    for (const line of lane.lines) {
      let targetHash = line.toCommit;
      let targetIndex = rowIndexByHash[targetHash];
      const isStraight = lane.column === line.toColumn;
      let isStub = false;
      let isDashed = false;
      if (targetIndex == null) {
        const resolved = isStraight ? resolveVisibleTarget(targetHash, visible, lanes) : null;
        if (!resolved) {
          isStub = true;
        } else {
          isDashed = resolved !== targetHash;
          targetHash = resolved;
          targetIndex = rowIndexByHash[targetHash];
          if (targetIndex == null) isStub = true;
        }
      }
      const targetLane = lanes[targetHash];
      let toX = targetLane
        ? colX(targetLane.column)
        : line.hiddenParent && lanes[line.toCommit]
          ? colX(lanes[line.toCommit]!.column)
          : colX(line.toColumn);
      let toY: number;
      if (isStub) {
        toY = fromY + ROW_HEIGHT;
        if (!isStraight) {
          const delta = toX - fromX;
          toX = fromX + Math.sign(delta) * Math.min(Math.abs(delta), COLUMN_WIDTH * 0.5);
        } else {
          toX = fromX;
        }
      } else {
        toY = rowY(targetIndex ?? index);
      }
      lines.push({
        key: `${commit.hash}-${line.toCommit}-${lane.column}-${line.toColumn}`,
        d: linePath(fromX, fromY, toX, toY, isStub),
        color,
        isDashed,
        minY: Math.min(fromY, toY),
        maxY: Math.max(fromY, toY),
      });
    }
  }
  return { lines, nodes };
}

export interface LogCommitFilter {
  search: string;
  author: string;
  since: string;
  until: string;
}

interface Props {
  target: GitTarget;
  refreshToken: number;
  selectedRef: { type: string; name: string; fullRef: string } | null;
  currentBranch: string | null;
  onBusy: (label: string | null) => void;
  onChanged: () => void;
  onOpenFileDiff: (options: { from: string; to: string; file: string; label: string }) => void;
  onOpenFileAtRevision: (hash: string, filePath: string) => void;
  onOpenFileHistory: (filePath: string) => void;
  onOpenBlame: (filePath: string) => void;
  onSelectedCommitChange?: (commit: CommitNode | null) => void;
}

type GraphPage =
  | { status: "ok"; hasMore: boolean; graphData: GraphData; snapshot: unknown }
  | { status: "ref-unavailable"; ref: { fullRef: string; name: string } };

export function LogPanel({
  target,
  refreshToken,
  selectedRef,
  currentBranch,
  onBusy,
  onChanged,
  onOpenFileDiff,
  onOpenFileAtRevision,
  onOpenFileHistory,
  onOpenBlame,
  onSelectedCommitChange,
}: Props) {
  const { t } = useI18n();
  const { menu, open, close } = useGitMenu();
  const { run, busy, error, clearError } = useGitMutation(target);
  const [filters, setFilters] = useState<LogCommitFilter>({ search: "", author: "", since: "", until: "" });
  const [showFilters, setShowFilters] = useState(false);
  const [commits, setCommits] = useState<CommitNode[]>([]);
  const [lanes, setLanes] = useState<GraphData["lanes"]>({});
  const [snapshot, setSnapshot] = useState<unknown>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [unavailableRef, setUnavailableRef] = useState<string | null>(null);
  const [selectedHash, setSelectedHash] = useState<string | null>(null);
  const [multi, setMulti] = useState<string[]>([]);
  const requestRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const params = useMemo(() => {
    const base: Record<string, unknown> = { maxCount: 200 };
    if (filters.search.trim()) base.search = filters.search.trim();
    if (filters.author.trim()) base.author = filters.author.trim();
    if (filters.since.trim()) base.since = filters.since.trim();
    if (filters.until.trim()) base.until = filters.until.trim();
    if (selectedRef) {
      base.currentRef = { type: selectedRef.type, name: selectedRef.name, fullRef: selectedRef.fullRef };
      if (selectedRef.type === "local") base.branch = selectedRef.name;
    }
    return base;
  }, [filters, selectedRef]);

  const paramsKey = JSON.stringify(params);

  useEffect(() => {
    const request = ++requestRef.current;
    setLoading(true);
    setUnavailableRef(null);
    void gitCommand<GraphPage>(target, "getGraphData", JSON.parse(paramsKey) as Record<string, unknown>)
      .then((page) => {
        if (request !== requestRef.current) return;
        if (page.status === "ref-unavailable") {
          setCommits([]);
          setLanes({});
          setUnavailableRef(page.ref.name);
          setLoading(false);
          return;
        }
        setCommits(page.graphData.commits);
        setLanes(page.graphData.lanes);
        setSnapshot(page.snapshot);
        setHasMore(page.hasMore);
        setLoading(false);
      })
      .catch(() => {
        if (request !== requestRef.current) return;
        setLoading(false);
      });
  }, [target, paramsKey, refreshToken]);

  const loadMore = async () => {
    if (loadingMore || !hasMore || snapshot == null) return;
    setLoadingMore(true);
    try {
      const page = await gitCommand<GraphPage>(target, "loadMoreLog", {
        ...(JSON.parse(paramsKey) as Record<string, unknown>),
        snapshot,
        count: 200,
      });
      if (page.status === "ok") {
        setCommits((current) => {
          const seen = new Set(current.map((commit) => commit.hash));
          return [...current, ...page.graphData.commits.filter((commit) => !seen.has(commit.hash))];
        });
        setLanes((current) => ({ ...current, ...page.graphData.lanes }));
        setSnapshot(page.snapshot);
        setHasMore(page.hasMore);
      } else {
        setHasMore(false);
      }
    } finally {
      setLoadingMore(false);
    }
  };

  const geometry = useMemo(() => buildGeometry(commits, lanes), [commits, lanes]);

  // The lanes the page actually uses, so the graph is as wide as the history is
  // deep. `lanes` is keyed by commit hash; a page of a wide repository reaches
  // column 17, and a fixed 76-pixel box would draw the last ten of them outside
  // it, where the reader sees a line that arrives from nowhere.
  // The panel's own width, so the graph and the subject split a phone panel
  // without a timer: a ResizeObserver is the panel telling the graph to resize.
  const [panelWidth, setPanelWidth] = useState(0);
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    setPanelWidth(element.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      const width = entry?.contentRect.width ?? 0;
      setPanelWidth((current) => (current === width ? current : width));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const graphWidth = useMemo(() => {
    let columns = 1;
    for (const lane of Object.values(lanes)) {
      columns = Math.max(columns, (lane.column ?? 0) + 1);
    }
    const needed = GRAPH_PADDING * 2 + columns * COLUMN_WIDTH;
    const budget = panelWidth > 0
      ? Math.max(GRAPH_MIN_WIDTH, Math.floor(panelWidth * GRAPH_PANEL_FRACTION))
      : GRAPH_MAX_WIDTH;
    return Math.min(needed, GRAPH_MAX_WIDTH, budget);
  }, [lanes, panelWidth]);

  const virtualizer = useVirtualizer({
    count: commits.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN_ROWS,
  });
  const items = virtualizer.getVirtualItems();
  const scrollTop = items[0]?.start ?? 0;
  const viewportHeight = scrollRef.current?.clientHeight ?? 600;
  const viewTop = scrollTop - OVERSCAN_ROWS * ROW_HEIGHT;
  const viewBottom = scrollTop + viewportHeight + OVERSCAN_ROWS * ROW_HEIGHT;
  const visibleLines = geometry.lines.filter((line) => line.maxY >= viewTop && line.minY <= viewBottom);
  const visibleNodes = geometry.nodes.filter((node) => node.cy >= viewTop && node.cy <= viewBottom);

  const selected = commits.find((commit) => commit.hash === selectedHash) ?? null;
  useEffect(() => {
    onSelectedCommitChange?.(selected);
  }, [selected, onSelectedCommitChange]);

  const act = async (label: string, command: string, paramsValue: Record<string, unknown> = {}) => {
    onBusy(label);
    const result = await run(command, paramsValue);
    onBusy(null);
    if (result === null) return;
    await gitCommand(target, "refreshGitState").catch(() => null);
    onChanged();
  };

  const commitMenu = (commit: CommitNode): GitMenuItem[] => [
    {
      id: "copy-hash",
      label: t("git.copyHash"),
      hint: commit.shortHash,
      onSelect: () => void navigator.clipboard?.writeText(commit.hash).catch(() => {}),
    },
    {
      id: "copy-subject",
      label: t("git.copySubject"),
      onSelect: () => void navigator.clipboard?.writeText(commit.subject).catch(() => {}),
    },
    { id: "sep1", label: "", separator: true },
    {
      id: "cherry",
      label: t("git.cherryPick"),
      disabled: Boolean(busy),
      onSelect: () => void act(t("git.cherryPick"), "cherryPick", { hash: commit.hash }),
    },
    {
      id: "revert",
      label: t("git.revert"),
      disabled: Boolean(busy),
      onSelect: () => void act(t("git.revert"), "revertCommit", { hash: commit.hash }),
    },
    { id: "sep2", label: "", separator: true },
    {
      id: "checkout-rev",
      label: t("git.checkoutRevision"),
      disabled: Boolean(busy),
      onSelect: () => void act(t("git.checkoutRevision"), "checkoutCommit", { hash: commit.hash }),
    },
    {
      id: "reset-mixed",
      label: t("git.resetMixed"),
      disabled: Boolean(busy),
      onSelect: () => void act(t("git.resetMixed"), "resetToCommit", { hash: commit.hash, mode: "mixed" }),
    },
    {
      id: "reset-soft",
      label: t("git.resetSoft"),
      disabled: Boolean(busy),
      onSelect: () => void act(t("git.resetSoft"), "resetToCommit", { hash: commit.hash, mode: "soft" }),
    },
    {
      id: "reset-hard",
      label: t("git.resetHard"),
      danger: true,
      disabled: Boolean(busy),
      onSelect: () => void act(t("git.resetHard"), "resetToCommit", { hash: commit.hash, mode: "hard" }),
    },
    {
      id: "drop",
      label: t("git.dropCommit"),
      danger: true,
      disabled: Boolean(busy),
      onSelect: () => void act(t("git.dropCommit"), "dropCommit", { hash: commit.hash }),
    },
    { id: "sep3", label: "", separator: true },
    {
      id: "new-branch",
      label: t("git.branchFromCommit"),
      onSelect: () => void navigator.clipboard?.writeText(commit.shortHash).catch(() => {}),
    },
  ];

  const selectRow = (commit: CommitNode, event: React.MouseEvent) => {
    if (event.metaKey || event.ctrlKey) {
      setMulti((current) =>
        current.includes(commit.hash) ? current.filter((hash) => hash !== commit.hash) : [...current, commit.hash],
      );
      return;
    }
    setMulti([]);
    setSelectedHash(commit.hash);
  };

  return (
    <div className="git-log-panel">
      <div className="git-panel-section-header">
        <span className="git-panel-section-title">{t("git.logTitle")}</span>
        <span className="git-panel-section-count">{commits.length}</span>
        <span className="git-toolbar-spacer" />
        <GitIconButton
          label={t("git.filterToggle")}
          active={showFilters || Boolean(filters.search || filters.author || filters.since || filters.until)}
          onClick={() => setShowFilters((value) => !value)}
        >
          <FilterIcon />
        </GitIconButton>
        <GitIconButton label={t("gitPanel.reload")} onClick={() => {
          setSnapshot(null);
          void gitCommand(target, "refreshGitState").catch(() => null);
          onChanged();
        }}>
          <RefreshIcon />
        </GitIconButton>
      </div>

      {selectedRef ? (
        <div className="git-filter-chips">
          <span className="git-chip">
            {selectedRef.name}
            <button
              type="button"
              className="git-chip-clear"
              aria-label={t("git.clearFilter")}
              onClick={() => {
                setFilters({ search: "", author: "", since: "", until: "" });
              }}
            >
              ×
            </button>
          </span>
        </div>
      ) : null}

      {showFilters ? (
        <div className="git-filter-row">
          <input
            className="git-search-input"
            type="search"
            value={filters.search}
            placeholder={t("git.filterSearch")}
            aria-label={t("git.filterSearch")}
            onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))}
          />
          <input
            className="git-search-input git-search-author"
            type="search"
            value={filters.author}
            placeholder={t("git.filterAuthor")}
            aria-label={t("git.filterAuthor")}
            onChange={(event) => setFilters((current) => ({ ...current, author: event.target.value }))}
          />
          <input
            className="git-date-input"
            type="date"
            value={filters.since}
            aria-label={t("git.filterSince")}
            onChange={(event) => setFilters((current) => ({ ...current, since: event.target.value }))}
          />
          <input
            className="git-date-input"
            type="date"
            value={filters.until}
            aria-label={t("git.filterUntil")}
            onChange={(event) => setFilters((current) => ({ ...current, until: event.target.value }))}
          />
        </div>
      ) : null}

      <GitErrorLine error={error} />
      {unavailableRef ? <GitState kind="empty" text={t("git.refUnavailable", { ref: unavailableRef })} /> : null}
      {loading ? <GitState kind="loading" text={t("git.logLoading")} /> : null}
      {!loading && !commits.length && !unavailableRef ? <GitState kind="empty" text={t("git.logEmpty")} /> : null}

      <div
        className="git-log-scroll"
        ref={scrollRef}
        role="grid"
        aria-label={t("git.logTitle")}
        // The rows are indented by the graph's width, so the two have to be told
        // the same number; the sheet reads it from here.
        style={{ "--git-graph-width": `${graphWidth}px` } as CSSProperties}
      >
        <svg
          className="git-graph-layer"
          width={graphWidth}
          height={commits.length * ROW_HEIGHT}
          viewBox={`0 0 ${graphWidth} ${commits.length * ROW_HEIGHT}`}
          aria-hidden="true"
        >
          {visibleLines.map((line) => (
            <path
              key={line.key}
              d={line.d}
              stroke={line.color}
              strokeWidth={1.5}
              fill="none"
              strokeDasharray={line.isDashed ? "3 3" : undefined}
              opacity={0.85}
            />
          ))}
          {visibleNodes.map((node) => (
            <g key={node.key}>
              {node.isMerge ? (
                <>
                  <circle cx={node.cx} cy={node.cy} r={4.2} fill={node.color} />
                  <circle cx={node.cx} cy={node.cy} r={1.6} fill="var(--git-graph-node-hole)" />
                </>
              ) : (
                <circle cx={node.cx} cy={node.cy} r={3.1} fill={node.color} />
              )}
              {node.isHead ? (
                <circle cx={node.cx} cy={node.cy} r={5.6} fill="none" stroke={node.color} strokeWidth={1.1} />
              ) : null}
            </g>
          ))}
        </svg>

        <div className="git-log-rows" style={{ height: commits.length * ROW_HEIGHT }}>
          {items.map((item) => {
            const commit = commits[item.index];
            if (!commit) return null;
            const isSelected = commit.hash === selectedHash;
            const isMulti = multi.includes(commit.hash);
            return (
              <div
                key={commit.hash}
                className={`git-log-row${isSelected ? " is-selected" : ""}${isMulti ? " is-multi" : ""}`}
                role="row"
                aria-selected={isSelected}
                tabIndex={-1}
                style={{ transform: `translateY(${item.start}px)` }}
                onClick={(event) => selectRow(commit, event)}
                onDoubleClick={() => onOpenFileAtRevision(commit.hash, "")}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setSelectedHash(commit.hash);
                  open(event.currentTarget, commitMenu(commit));
                }}
              >
                <span className="git-log-refs">
                  {commit.refs.map((ref) => (
                    <span
                      key={`${ref.type}-${ref.name}`}
                      className={`git-ref-chip git-ref-${ref.type === "remote-branch" ? "remote" : ref.type}`}
                    >
                      {ref.name}
                    </span>
                  ))}
                </span>
                <span className="git-log-subject" title={commit.subject}>
                  {commit.subject}
                </span>
                <span className="git-log-author" title={commit.authorEmail}>
                  {commit.authorName}
                </span>
                <span className="git-log-hash">{commit.shortHash}</span>
                <span className="git-log-date" title={formatFullTime(commit.authorDate)}>
                  {formatCommitTime(commit.authorDate)}
                </span>
                <GitRowMenuButton
                  label={t("git.rowMenu")}
                  items={commitMenu(commit)}
                  onOpen={(anchor) => open(anchor, commitMenu(commit))}
                />
              </div>
            );
          })}
        </div>

        {hasMore && commits.length ? (
          <div className="git-log-more">
            <button type="button" className="git-inline-button" onClick={() => void loadMore()} disabled={loadingMore}>
              {loadingMore ? t("git.logLoading") : t("git.loadMore")}
            </button>
          </div>
        ) : null}
      </div>

      {menu ? <GitMenu menu={menu as GitMenuState} onDone={close} /> : null}

      <CommitDetail
        target={target}
        commit={selected}
        busy={busy}
        onBusy={onBusy}
        onChanged={onChanged}
        onOpenFileDiff={onOpenFileDiff}
        onOpenFileAtRevision={onOpenFileAtRevision}
        onOpenFileHistory={onOpenFileHistory}
        onOpenBlame={onOpenBlame}
        multiHashes={multi}
      />
    </div>
  );
}

import { CommitDetail } from "./CommitDetail";

function FilterIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
      <path d="M2.5 3.6h11M4.4 8h7.2M6.4 12.4h3.2" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
      <path d="M13 8a5 5 0 1 1-1.6-3.7M13 2.6V5.4H10.2" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
