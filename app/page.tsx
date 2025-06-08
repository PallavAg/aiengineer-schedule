"use client";

import { useState, useEffect, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import {
  SignInButton,
  SignUpButton,
  SignedIn,
  SignedOut,
  UserButton,
} from "@clerk/nextjs";
import SessionCard from "./components/SessionCard";
import CalendarView from "./components/CalendarView";
import SpeakersView from "./components/SpeakersView";
import SessionDetailModal from "./components/SessionDetailModal";
import FilterBar from "./components/FilterBar";
import SearchOverlay from "./components/SearchOverlay";
import { ScheduleData, SessionMoreInfo, Session } from "./types/schedule";
import { useBookmarksAndStarsContext } from "./contexts/BookmarksAndStarsContext";
import { getSessionDay } from "./utils/dateTime";
import { EmailIcon, GithubIcon, SpeakerIcon, TalkIcon } from "./utils/svgs";
import ScheduleDataService from "./utils/scheduleDataService";
import {
  getSessionTrack,
  extractTrackFromAssigned,
  requiresAILeadersPass,
} from "./utils/trackUtils";

export default function Home() {
  const [sessionIdFromUrl, setSessionIdFromUrl] = useState<string | null>(null);
  const searchParams = useSearchParams();

  const [data, setData] = useState<ScheduleData>({
    sessions: [],
    speakers: [],
    rooms: [],
    questions: [],
    categories: [],
  });
  const [mainView, setMainView] = useState<"speakers" | "talks">("talks");

  // Default to current date if it's June 4th or 5th, otherwise 'all'
  const currentDate = new Date();
  const currentMonth = currentDate.getMonth(); // 0-indexed, so June is 5
  const currentDay = currentDate.getDate();
  const defaultDay =
    currentMonth === 5 && currentDay === 4
      ? 1 // June 4 maps to day 1
      : currentMonth === 5 && currentDay === 5
      ? 2 // June 5 maps to day 2
      : 0; // Otherwise show all days

  const [selectedDay, setSelectedDay] = useState(defaultDay);
  const [selectedTrack, setSelectedTrack] = useState("");
  const [showBookmarked, setShowBookmarked] = useState(false);
  const [showStarred, setShowStarred] = useState(false);
  const [viewMode, setViewMode] = useState<"list" | "calendar">("list");
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isCompactView, setIsCompactView] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  const {
    bookmarks: bookmarkedIds,
    starred: starredIds,
    addBookmark,
    removeBookmark,
    isBookmarked,
    addStarred,
    removeStarred,
    isStarred,
    loading: bookmarksLoading,
    isAuthenticated,
  } = useBookmarksAndStarsContext();

  useEffect(() => {
    const loadScheduleData = async () => {
      setIsLoading(true);
      setLoadError(null);

      try {
        const scheduleService = ScheduleDataService.getInstance();
        const { schedule, moreInfo } =
          await scheduleService.fetchScheduleData();

        // Merge schedule data with additional info
        const moreInfoMap = new Map<string, SessionMoreInfo>();
        (moreInfo as SessionMoreInfo[]).forEach((info) => {
          moreInfoMap.set(info["Session ID"], info);
        });

        const mergedSessions = schedule.sessions.map((session) => {
          const moreInfoData = moreInfoMap.get(session.id);
          if (moreInfoData) {
            return {
              ...session,
              level: moreInfoData.Level || undefined,
              scope: moreInfoData.Scope || undefined,
              assignedTrack: moreInfoData["Assigned Track"] || undefined,
              companies: moreInfoData.Companies || undefined,
            };
          }
          return session;
        });

        // Add manual keynote events for June 4th
        const manualKeynoteEvents: Session[] = [
          {
            id: "manual-keynote-1",
            title: "Welcome to AI Engineer",
            description:
              "Emcee Laurie Voss and curator swyx kick off the conference.",
            startsAt: "2025-06-04T09:00:00",
            endsAt: "2025-06-04T09:20:00",
            isServiceSession: false,
            isPlenumSession: true,
            speakers: [],
            categoryItems: [],
            questionAnswers: [],
            roomId: 61336, // Keynote/General Session (Yerba Buena 7&8)
            liveUrl: null,
            recordingUrl: null,
            status: "Accepted",
            isInformed: true,
            isConfirmed: true,
          },
          {
            id: "manual-keynote-2",
            title: "Track Intros ft. Agentic GraphRAG",
            description:
              "Laurie introduces each track, with special feature from Stephen Chin",
            startsAt: "2025-06-04T10:20:00",
            endsAt: "2025-06-04T10:30:00",
            isServiceSession: false,
            isPlenumSession: true,
            speakers: [],
            categoryItems: [],
            questionAnswers: [],
            roomId: 61336, // Keynote/General Session (Yerba Buena 7&8)
            liveUrl: null,
            recordingUrl: null,
            status: "Accepted",
            isInformed: true,
            isConfirmed: true,
          },
        ];

        // Combine original sessions with manual events
        const allSessions = [...mergedSessions, ...manualKeynoteEvents];

        setData({
          ...schedule,
          sessions: allSessions,
        });
      } catch (error) {
        console.error("Error loading schedule data:", error);
        setLoadError("Failed to load schedule data. Please try again later.");
      } finally {
        setIsLoading(false);
      }
    };

    loadScheduleData();
  }, []);

  // Get session ID from URL on client side
  useEffect(() => {
    const sessionId = searchParams?.get("session");
    if (sessionId) {
      setSessionIdFromUrl(sessionId);
    }
  }, [searchParams]);

  // Open modal if session ID is in URL
  useEffect(() => {
    if (sessionIdFromUrl && data.sessions.length > 0 && !isLoading) {
      const session = data.sessions.find((s) => s.id === sessionIdFromUrl);
      if (session) {
        setSelectedSession(session);
        setIsModalOpen(true);
      }
    }
  }, [sessionIdFromUrl, data.sessions, isLoading]);

  // Get unique tracks from sessions
  const availableTracks = useMemo(() => {
    const tracks = new Set<string>();
    data.sessions.forEach((session) => {
      // Get room name for this session
      const room = data.rooms.find((r) => r.id === session.roomId);
      const track = getSessionTrack(session.assignedTrack, room?.name);

      if (track) {
        // Store the cleaned track name (without parentheses)
        tracks.add(track);
      }
    });
    return Array.from(tracks).sort();
  }, [data.sessions, data.rooms]);

  const filteredSessions = useMemo(() => {
    let filtered = data.sessions;

    // Filter by day
    if (selectedDay !== 0) {
      filtered = filtered.filter(
        (session) => getSessionDay(session.startsAt) === selectedDay
      );
    }

    // Filter by track
    if (selectedTrack) {
      filtered = filtered.filter((session) => {
        // Get room name for this session
        const room = data.rooms.find((r) => r.id === session.roomId);
        const sessionTrack = getSessionTrack(session.assignedTrack, room?.name);

        // Compare the extracted track with the selected track
        return sessionTrack === selectedTrack;
      });
    }

    // Filter by bookmarked/starred
    if (showBookmarked) {
      filtered = filtered.filter((session) =>
        bookmarkedIds.includes(session.id)
      );
    }

    if (showStarred) {
      filtered = filtered.filter((session) => starredIds.includes(session.id));
    }

    // Sort by start time
    return filtered.sort(
      (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()
    );
  }, [
    data.sessions,
    data.rooms,
    selectedDay,
    selectedTrack,
    showBookmarked,
    showStarred,
    bookmarkedIds,
    starredIds,
  ]);

  const handleSessionClick = (session: Session) => {
    setSelectedSession(session);
    setIsModalOpen(true);

    // Add session parameter to URL
    const newUrl = new URL(window.location.href);
    newUrl.searchParams.set("session", session.id);
    window.history.pushState({}, "", newUrl.toString());
    setSessionIdFromUrl(session.id);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setSelectedSession(null);

    // Remove session parameter from URL
    if (sessionIdFromUrl) {
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.delete("session");
      window.history.replaceState({}, "", newUrl.pathname);
      setSessionIdFromUrl(null);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-dark-bg transition-colors duration-300">
      {/* Header */}
      <header className="bg-white dark:bg-dark-bg border-b border-gray-200 dark:border-dark-border shadow-subtle dark:shadow-dark-subtle">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
          {/* Top Header Row - Repeated for maximum customizability */}
          <div className="py-4 lg:py-6">
            {/* Mobile View */}
            <div className="sm:hidden">
              <SignedIn>
                {/* Mobile Signed In: Title left, UserButton right */}
                <div className="flex items-center justify-between">
                  <div>
                    <h1 className="text-xl font-bold text-gray-900 dark:text-dark-text-primary">
                      AI Engineer World's Fair 2025
                    </h1>
                    <p className="text-sm text-gray-600 dark:text-dark-text-secondary">
                      June 3-5, 2025 • San Francisco •{" "}
                      <a
                        href="https://x.com/pallavmac"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-500 dark:text-blue-400 hover:underline"
                      >
                        👨‍💻 @pallavmac
                      </a>
                    </p>
                  </div>
                  <UserButton
                    appearance={{
                      elements: {
                        avatarBox: "w-8 h-8", // Mobile specific size
                      },
                    }}
                  >
                    <UserButton.MenuItems>
                      <UserButton.Action
                        label="Contact"
                        labelIcon={<EmailIcon />}
                        onClick={() =>
                          window.open("mailto:agpallav@gmail.com", "_blank")
                        }
                      />
                      <UserButton.Link
                        label="Contribute"
                        labelIcon={<GithubIcon />}
                        href="https://github.com/PallavAg/aiengineer-schedule"
                      />
                      {/* Status Text */}
                      <UserButton.Action
                        label="Schedule up to date"
                        labelIcon={<p>🟢</p>}
                        onClick={() =>
                          window.open(
                            "https://www.ai.engineer/schedule",
                            "_blank"
                          )
                        }
                      />
                    </UserButton.MenuItems>
                  </UserButton>
                </div>
              </SignedIn>
              <SignedOut>
                {/* Mobile Signed Out: Title top, Buttons bottom */}
                <div className="flex flex-col">
                  <div>
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-dark-text-primary">
                      AI Engineer World's Fair 2025
                    </h1>
                    <p className="text-sm text-gray-600 dark:text-dark-text-secondary">
                      June 3-5, 2025 • San Francisco •{" "}
                      <a
                        href="https://x.com/pallavmac"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-500 dark:text-blue-400 hover:underline"
                      >
                        👨‍💻 @pallavmac
                      </a>
                    </p>
                    <div className="flex flex-row items-center gap-[6px] text-xs text-gray-600 dark:text-dark-text-secondary mt-2">
                      <button
                        className="flex flex-row rounded-lg bg-gray-100 dark:bg-dark-hover px-2 py-1 gap-1 items-center shadow-subtle dark:shadow-dark-subtle border-[1.5px] border-gray-200 dark:border-gray-400/10"
                        onClick={() =>
                          window.open(
                            "https://github.com/PallavAg/aiengineer-schedule",
                            "_blank"
                          )
                        }
                      >
                        <GithubIcon /> Contribute
                      </button>
                      <button
                        className="flex flex-row rounded-lg bg-gray-100 dark:bg-dark-hover px-2 py-1 gap-1 items-center shadow-subtle dark:shadow-dark-subtle border-[1.5px] border-gray-200 dark:border-gray-400/10"
                        onClick={() =>
                          window.open("mailto:agpallav@gmail.com", "_blank")
                        }
                      >
                        <EmailIcon /> Contact
                      </button>
                      <div className="flex flex-row rounded-lg bg-gray-100 dark:bg-dark-hover px-2 py-1 gap-2 items-center shadow-subtle dark:shadow-dark-subtle border-[1.5px] border-gray-200 dark:border-gray-400/10">
                        <div className="w-2 h-2 bg-green-500 rounded-full shadow-[0_0_8px_rgba(34,197,94,0.6)]"></div>
                        <button
                          className="text-green-600 dark:text-green-400 cursor-default"
                          onClick={() =>
                            window.open(
                              "https://www.ai.engineer/schedule",
                              "_blank"
                            )
                          }
                        >
                          Schedule up to date
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="mt-3">
                    <div className="flex flex-row items-center gap-2">
                      <div className="flex gap-2">
                        <SignInButton mode="modal">
                          <button className="px-4 py-1.5 text-sm bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-gray-200 rounded-lg border border-gray-900 dark:border-gray-100 transition-all duration-200 shadow-subtle hover:shadow-card">
                            Sign In
                          </button>
                        </SignInButton>
                        <SignUpButton mode="modal">
                          <button className="px-4 py-1.5 text-sm bg-gray-100 dark:bg-dark-hover text-gray-900 dark:text-dark-text-primary hover:bg-gray-200 dark:hover:bg-dark-border rounded-lg border-2 border-gray-200 dark:border-gray-400/10 transition-all duration-200 shadow-subtle hover:shadow-card">
                            Sign Up
                          </button>
                        </SignUpButton>
                      </div>
                      <p className="text-xs text-gray-600 dark:text-dark-text-muted">
                        ← Sync across devices
                      </p>
                    </div>
                  </div>
                </div>
              </SignedOut>
            </div>

            {/* Desktop View (sm and larger) - Replicates original layout */}
            <div className="hidden sm:flex sm:items-center sm:justify-between gap-3">
              {/* Title Block (Left) */}
              <div>
                <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-gray-900 dark:text-dark-text-primary">
                  AI Engineer World's Fair 2025 Schedule
                </h1>
                <p className="mt-1 text-base text-gray-600 dark:text-dark-text-secondary">
                  June 3-5, 2025 • San Francisco •{" "}
                  <a
                    href="https://x.com/pallavmac"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-500 dark:text-blue-400 hover:underline"
                  >
                    👨‍💻 @pallavmac
                  </a>
                </p>
                <div className="flex flex-row items-center gap-[6px] text-sm text-gray-600 dark:text-dark-text-secondary mt-2">
                  <button
                    className="flex flex-row rounded-lg bg-gray-100 dark:bg-dark-hover px-2 py-1 gap-1 items-center shadow-subtle dark:shadow-dark-subtle border-[1.5px] border-gray-200 dark:border-gray-400/10"
                    onClick={() =>
                      window.open(
                        "https://github.com/PallavAg/aiengineer-schedule",
                        "_blank"
                      )
                    }
                  >
                    <GithubIcon /> Contribute
                  </button>
                  <button
                    className="flex flex-row rounded-lg bg-gray-100 dark:bg-dark-hover px-2 py-1 gap-1 items-center shadow-subtle dark:shadow-dark-subtle border-[1.5px] border-gray-200 dark:border-gray-400/10"
                    onClick={() =>
                      window.open("mailto:agpallav@gmail.com", "_blank")
                    }
                  >
                    <EmailIcon /> Contact
                  </button>
                  <div className="flex flex-row rounded-lg bg-gray-100 dark:bg-dark-hover px-2 py-1 gap-2 items-center shadow-subtle dark:shadow-dark-subtle border-[1.5px] border-gray-200 dark:border-gray-400/10">
                    <div className="w-2 h-2 bg-green-500 rounded-full shadow-[0_0_8px_rgba(34,197,94,0.6)]"></div>
                    <button
                      className="text-green-600 dark:text-green-400 cursor-default"
                      onClick={() =>
                        window.open(
                          "https://www.ai.engineer/schedule",
                          "_blank"
                        )
                      }
                    >
                      Schedule up to date
                    </button>
                  </div>
                </div>
              </div>
              {/* Auth Block (Right) */}
              <div className="flex items-center">
                <SignedOut>
                  <div className="flex flex-row sm:flex-col gap-2 sm:gap-1 items-center">
                    <div className="flex gap-2">
                      <SignInButton mode="modal">
                        <button className="px-3 py-1.5 sm:px-6 sm:py-2 text-sm bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-gray-200 rounded-lg border border-gray-900 dark:border-white transition-all duration-200 shadow-subtle hover:shadow-card">
                          Sign In
                        </button>
                      </SignInButton>
                      <SignUpButton mode="modal">
                        <button className="px-3 py-1.5 sm:px-6 sm:py-2 text-sm bg-gray-100 dark:bg-dark-hover text-gray-900 dark:text-dark-text-primary hover:bg-gray-200 dark:hover:bg-dark-border rounded-lg border-2 border-gray-200 dark:border-gray-400/10 transition-all duration-200 shadow-subtle hover:shadow-card">
                          Sign Up
                        </button>
                      </SignUpButton>
                    </div>
                    <p className="text-xs text-gray-600 dark:text-dark-text-muted">
                      To sync across devices
                    </p>
                  </div>
                </SignedOut>
                <SignedIn>
                  <UserButton
                    appearance={{
                      elements: {
                        avatarBox: "w-8 h-8 sm:w-9 sm:h-9", // Original responsive sizes
                      },
                    }}
                  />
                </SignedIn>
              </div>
            </div>
          </div>

          {/* Navigation Row */}
          <div className="border-t border-gray-100 dark:border-dark-border">
            <div className="py-3">
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 sm:gap-4">
                <div className="flex items-center gap-4">
                  {/* Main View Toggle */}
                  <div className="flex gap-1 bg-gray-100 dark:bg-dark-hover rounded-lg p-1 shadow-subtle dark:shadow-dark-subtle">
                    <button
                      onClick={() => setMainView("talks")}
                      className={`flex-1 sm:flex-initial px-3 sm:px-4 py-1.5 sm:py-2 rounded-md text-sm font-medium transition-all duration-200 flex items-center justify-center sm:justify-start gap-1.5 ${
                        mainView === "talks"
                          ? "bg-white dark:bg-dark-option text-gray-900 dark:text-dark-text-primary shadow-card dark:shadow-dark-card"
                          : "text-gray-600 dark:text-dark-text-secondary hover:text-gray-900 dark:hover:text-dark-text-primary"
                      }`}
                    >
                      <TalkIcon />
                      Talks
                    </button>
                    <button
                      onClick={() => setMainView("speakers")}
                      className={`flex-1 sm:flex-initial px-3 sm:px-4 py-1.5 sm:py-2 rounded-md text-sm font-medium transition-all duration-200 flex items-center justify-center sm:justify-start gap-1.5 ${
                        mainView === "speakers"
                          ? "bg-white dark:bg-dark-option text-gray-900 dark:text-dark-text-primary shadow-card dark:shadow-dark-card"
                          : "text-gray-600 dark:text-dark-text-secondary hover:text-gray-900 dark:hover:text-dark-text-primary"
                      }`}
                    >
                      <SpeakerIcon />
                      Speakers
                    </button>
                  </div>

                  <div className="w-px h-8 bg-gray-200 dark:bg-dark-border" />

                  {/* Track Filter */}
                  <div className="relative">
                    <select
                      value={selectedTrack}
                      onChange={(e) => setSelectedTrack(e.target.value)}
                      className="h-9 sm:h-auto w-full px-3 sm:px-4 py-1.5 sm:py-2 pr-8 text-sm bg-white dark:bg-dark-card text-gray-900 dark:text-dark-text-primary border border-gray-300 dark:border-dark-border rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-400 dark:focus:ring-gray-600 appearance-none shadow-subtle dark:shadow-dark-subtle transition-all duration-200 hover:border-gray-400 dark:hover:border-dark-text-muted"
                      style={{
                        fontSize: "14px", // Prevents iOS zoom on focus
                        lineHeight: "1.3",
                      }}
                    >
                      <option value="">All Tracks</option>
                      {availableTracks.map((track) => (
                        <option key={track} value={track}>
                          {track}
                        </option>
                      ))}
                    </select>
                    <div className="absolute inset-y-0 right-0 flex items-center pr-2 pointer-events-none">
                      <svg
                        className="w-4 h-4 text-gray-500 dark:text-dark-text-muted"
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                      >
                        <path
                          fillRule="evenodd"
                          d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
                          clipRule="evenodd"
                        />
                      </svg>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Loading State */}
      {isLoading ? (
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 dark:border-gray-100 mx-auto"></div>
            <p className="mt-4 text-gray-600 dark:text-dark-text-secondary">
              Fetching schedule...
            </p>
          </div>
        </div>
      ) : loadError ? (
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center max-w-md">
            <p className="text-red-600 dark:text-red-400 mb-2">{loadError}</p>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 text-sm bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-gray-200 rounded-lg transition-all duration-200"
            >
              Retry
            </button>
          </div>
        </div>
      ) : mainView === "talks" ? (
        <>
          {/* Filter Bar */}
          <FilterBar
            selectedDay={selectedDay}
            setSelectedDay={setSelectedDay}
            showBookmarked={showBookmarked}
            setShowBookmarked={setShowBookmarked}
            showStarred={showStarred}
            setShowStarred={setShowStarred}
            viewMode={viewMode}
            setViewMode={setViewMode}
          />

          {/* Main Content - Talks */}
          <main className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-8">
            {filteredSessions.length === 0 ? (
              <div className="text-center py-8 sm:py-12">
                <p className="text-gray-500 dark:text-dark-text-muted text-base sm:text-lg">
                  No sessions found matching your filters.
                </p>
              </div>
            ) : viewMode === "calendar" ? (
              <CalendarView
                sessions={filteredSessions}
                speakers={data.speakers}
                rooms={data.rooms}
                selectedDay={selectedDay}
                showBookmarked={showBookmarked}
                showStarred={showStarred}
                onSessionClick={handleSessionClick}
                bookmarkedIds={bookmarkedIds}
                starredIds={starredIds}
                onBookmarkToggle={() => {
                  // Not used in CalendarView
                }}
                onStarToggle={() => {
                  // Not used in CalendarView
                }}
              />
            ) : (
              <div>
                {/* Disclaimer that June 3 workshops are for people with the 'Conference + Workshop Pass' only */}
                {selectedDay === 3 && (
                  <div className="bg-blue-50 dark:bg-blue-900/20 border-l-4 border-blue-400 dark:border-blue-600 text-blue-700 dark:text-blue-400 p-3 mb-4 rounded-lg max-w-xl shadow-subtle dark:shadow-dark-subtle">
                    <p className="font-medium text-sm">
                      Note: June 3rd workshops are for attendees with the{" "}
                      <i>Conference + Workshop Pass</i>
                    </p>
                  </div>
                )}

                {/* Disclaimer for AI Leaders tracks */}
                {selectedTrack && requiresAILeadersPass(selectedTrack) && (
                  <div className="bg-purple-50 dark:bg-purple-900/20 border-l-4 border-purple-400 dark:border-purple-600 text-purple-700 dark:text-purple-400 p-3 mb-4 rounded-lg max-w-xl shadow-subtle dark:shadow-dark-subtle">
                    <p className="font-medium text-sm">
                      Note: This track is available for those with the{" "}
                      <i>AI Leaders</i> pass
                    </p>
                  </div>
                )}

                {/* Compact Toggle and Search Button */}
                <div className="flex items-center justify-between mb-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <span className="text-sm font-medium text-gray-700 dark:text-dark-text-primary/60">
                      Compact
                    </span>
                    <button
                      onClick={() => setIsCompactView(!isCompactView)}
                      className={`relative w-11 h-6 rounded-full transition-colors duration-300 ${
                        isCompactView
                          ? "bg-gray-900 dark:bg-gray-400"
                          : "bg-gray-300 dark:bg-dark-hover"
                      }`}
                      role="switch"
                      aria-checked={isCompactView}
                    >
                      <span
                        className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow-lg transition-transform duration-300 ${
                          isCompactView
                            ? "translate-x-5 dark:bg-black/90"
                            : "translate-x-0 dark:bg-black/90"
                        }`}
                      />
                    </button>
                  </label>

                  <button
                    onClick={() => setIsSearchOpen(true)}
                    className="flex items-center gap-2 px-3 py-1 text-sm font-medium text-gray-700 dark:text-dark-text-secondary bg-gray-100 dark:bg-dark-hover hover:bg-gray-200 dark:hover:bg-dark-border rounded-full transition-colors border border-gray-200 dark:border-dark-border"
                  >
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                      />
                    </svg>
                    <span>Search</span>
                  </button>
                </div>

                {/* Session Cards */}
                <div
                  className={`grid gap-3 sm:gap-4 ${
                    isCompactView
                      ? "grid-cols-1"
                      : "grid-cols-1 md:grid-cols-2 xl:grid-cols-3"
                  }`}
                >
                  {filteredSessions.map((session) => {
                    const speaker = data.speakers.find((s) =>
                      session.speakers.includes(s.id)
                    );
                    const room = data.rooms.find(
                      (r) => r.id === session.roomId
                    );
                    return (
                      <SessionCard
                        key={session.id}
                        session={session}
                        speaker={speaker}
                        room={room}
                        onClick={() => handleSessionClick(session)}
                        isBookmarked={bookmarkedIds.includes(session.id)}
                        isStarred={starredIds.includes(session.id)}
                        isCompactView={isCompactView}
                        showBookmarkedFilter={showBookmarked}
                        showStarredFilter={showStarred}
                        onBookmarkToggle={async () => {
                          if (isBookmarked(session.id)) {
                            await removeBookmark(session.id);
                          } else {
                            await addBookmark(session.id, session.title);
                          }
                        }}
                        onStarToggle={async () => {
                          if (isStarred(session.id)) {
                            await removeStarred(session.id);
                          } else {
                            await addStarred(session.id, session.title);
                          }
                        }}
                      />
                    );
                  })}
                </div>
              </div>
            )}
          </main>
        </>
      ) : (
        /* Speakers View */
        <SpeakersView
          speakers={data.speakers}
          sessions={data.sessions}
          rooms={data.rooms}
          selectedTrack={selectedTrack}
          onSessionClick={handleSessionClick}
        />
      )}

      {/* Session Detail Modal */}
      <SessionDetailModal
        session={selectedSession}
        speakers={
          selectedSession
            ? data.speakers.filter((s) =>
                selectedSession.speakers.includes(s.id)
              )
            : undefined
        }
        room={
          selectedSession
            ? data.rooms.find((r) => r.id === selectedSession.roomId)
            : undefined
        }
        isOpen={isModalOpen}
        onClose={closeModal}
        isBookmarked={
          selectedSession ? bookmarkedIds.includes(selectedSession.id) : false
        }
        isStarred={
          selectedSession ? starredIds.includes(selectedSession.id) : false
        }
        onBookmarkToggle={async () => {
          if (selectedSession) {
            if (isBookmarked(selectedSession.id)) {
              await removeBookmark(selectedSession.id);
            } else {
              await addBookmark(selectedSession.id, selectedSession.title);
            }
          }
        }}
        onStarToggle={async () => {
          if (selectedSession) {
            if (isStarred(selectedSession.id)) {
              await removeStarred(selectedSession.id);
            } else {
              await addStarred(selectedSession.id, selectedSession.title);
            }
          }
        }}
      />

      {/* Search Overlay */}
      <SearchOverlay
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        sessions={data.sessions}
        speakers={data.speakers}
        rooms={data.rooms}
        onSessionClick={handleSessionClick}
      />
    </div>
  );
}
