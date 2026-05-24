import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const sampleText =
  "Paste your text here, press Start, and read one word at a time.";
const LATE_FRAME_RESET_MS = 250;
const COMMA_PAUSE_MULTIPLIER = 1.5;
const SENTENCE_PAUSE_MULTIPLIER = 2.5;
const CLAUSE_PAUSE_MULTIPLIER = 2;
const JUMP_WORD_COUNT = 10;
const TOOLBAR_HIDE_DELAY_MS = 2000;
const SETTINGS_STORAGE_KEY = "rsvp-reader-settings";
const DEFAULT_SETTINGS = {
  hasWords: false,
  loadedFileName: "",
  theme: "midnight",
  text: sampleText,
  wordIndex: 0,
  wpm: 300
};
const THEME_OPTIONS = [
  { value: "midnight", label: "Midnight" },
  { value: "charcoal", label: "Charcoal" }
];

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function isValidTheme(theme) {
  return THEME_OPTIONS.some((option) => option.value === theme);
}

function readSavedSettings() {
  if (typeof window === "undefined") {
    return DEFAULT_SETTINGS;
  }

  try {
    const savedSettings = JSON.parse(
      window.localStorage.getItem(SETTINGS_STORAGE_KEY) || "{}"
    );

    return {
      ...DEFAULT_SETTINGS,
      ...savedSettings,
      loadedFileName:
        typeof savedSettings.loadedFileName === "string"
          ? savedSettings.loadedFileName
          : DEFAULT_SETTINGS.loadedFileName,
      theme: isValidTheme(savedSettings.theme)
        ? savedSettings.theme
        : DEFAULT_SETTINGS.theme,
      text:
        typeof savedSettings.text === "string"
          ? savedSettings.text
          : DEFAULT_SETTINGS.text,
      hasWords: Boolean(savedSettings.hasWords),
      wpm: clamp(Number(savedSettings.wpm) || DEFAULT_SETTINGS.wpm, 100, 800),
      wordIndex: Math.max(Number(savedSettings.wordIndex) || 0, 0)
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function saveSettings(settings) {
  try {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // If storage is unavailable, the reader should keep working normally.
  }
}

function isReadableCharacter(character) {
  return /[\p{L}\p{N}]/u.test(character);
}

function getOrpIndex(readableLength) {
  if (readableLength <= 1) {
    return 0;
  }

  if (readableLength <= 5) {
    return 1;
  }

  if (readableLength <= 9) {
    return 2;
  }

  if (readableLength <= 13) {
    return 3;
  }

  return 4;
}

function getOrpParts(word) {
  const characters = Array.from(word);
  const readableIndexes = characters
    .map((character, index) => (isReadableCharacter(character) ? index : null))
    .filter((index) => index !== null);

  if (readableIndexes.length === 0) {
    return {
      before: "",
      highlight: characters[0] || "",
      after: characters.slice(1).join("")
    };
  }

  const orpOffset = getOrpIndex(readableIndexes.length);
  const highlightIndex = readableIndexes[orpOffset];

  return {
    before: characters.slice(0, highlightIndex).join(""),
    highlight: characters[highlightIndex],
    after: characters.slice(highlightIndex + 1).join("")
  };
}

function getWordDelay(word, wordsPerMinute) {
  const baseDelay = 60000 / wordsPerMinute;

  // Give readers a little more time at natural sentence breaks.
  if (/[.?!][)"']*$/.test(word)) {
    return baseDelay * SENTENCE_PAUSE_MULTIPLIER;
  }

  if (/[;:][)"']*$/.test(word)) {
    return baseDelay * CLAUSE_PAUSE_MULTIPLIER;
  }

  if (/,[)"']*$/.test(word)) {
    return baseDelay * COMMA_PAUSE_MULTIPLIER;
  }

  return baseDelay;
}

function splitIntoWords(text) {
  return text.trim().split(/\s+/).filter(Boolean);
}

export default function App() {
  const initialSettingsRef = useRef(null);

  if (initialSettingsRef.current === null) {
    const savedSettings = readSavedSettings();
    const savedWords = savedSettings.hasWords
      ? splitIntoWords(savedSettings.text)
      : [];

    initialSettingsRef.current = {
      ...savedSettings,
      wordIndex:
        savedWords.length > 0
          ? clamp(savedSettings.wordIndex, 0, savedWords.length - 1)
          : 0,
      words: savedWords
    };
  }

  const initialSettings = initialSettingsRef.current;
  const [text, setText] = useState(initialSettings.text);
  const [words, setWords] = useState(initialSettings.words);
  const [wordIndex, setWordIndex] = useState(initialSettings.wordIndex);
  const [wpm, setWpm] = useState(initialSettings.wpm);
  const [theme, setTheme] = useState(initialSettings.theme);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isReaderMode, setIsReaderMode] = useState(
    initialSettings.words.length > 0
  );
  const [isEditingText, setIsEditingText] = useState(
    initialSettings.words.length === 0
  );
  const [isToolbarVisible, setIsToolbarVisible] = useState(true);
  const [loadedFileName, setLoadedFileName] = useState(
    initialSettings.loadedFileName
  );

  const fileInputRef = useRef(null);
  const frameIdRef = useRef(null);
  const nextWordTimeRef = useRef(0);
  const toolbarHasFocusRef = useRef(false);
  const toolbarTimerRef = useRef(null);
  const wordsRef = useRef(words);
  const wordIndexRef = useRef(wordIndex);
  const wpmRef = useRef(wpm);

  const currentWord = words[wordIndex] || "Ready";
  const currentWordParts = useMemo(() => getOrpParts(currentWord), [currentWord]);
  const progress = useMemo(() => {
    if (words.length === 0) {
      return 0;
    }

    return Math.round(((wordIndex + 1) / words.length) * 100);
  }, [wordIndex, words.length]);

  const startReading = useCallback(() => {
    const nextWords = splitIntoWords(text);

    if (nextWords.length === 0) {
      return;
    }

    wordsRef.current = nextWords;
    wordIndexRef.current = 0;
    setWords(nextWords);
    setWordIndex(0);
    setIsReaderMode(true);
    setIsEditingText(false);
    setIsToolbarVisible(true);
    setIsPlaying(true);
  }, [text]);

  const togglePlay = useCallback(() => {
    if (wordsRef.current.length === 0) {
      startReading();
      return;
    }

    if (wordIndexRef.current >= wordsRef.current.length - 1) {
      wordIndexRef.current = 0;
      setWordIndex(0);
      setIsReaderMode(true);
      setIsEditingText(false);
      setIsPlaying(true);
      return;
    }

    setIsReaderMode(true);
    setIsEditingText(false);
    setIsPlaying((playing) => !playing);
  }, [startReading]);

  const resetReading = useCallback(() => {
    wordsRef.current = [];
    wordIndexRef.current = 0;
    setWords([]);
    setWordIndex(0);
    setIsReaderMode(false);
    setIsEditingText(true);
    setIsPlaying(false);
  }, []);

  const handleTextChange = useCallback(
    (event) => {
      setText(event.target.value);
      setLoadedFileName("");
      resetReading();
    },
    [resetReading]
  );

  const loadTextFile = useCallback(async (event) => {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    const fileText = await file.text();

    setText(fileText);
    resetReading();
    setLoadedFileName(file.name);

    event.target.value = "";
  }, [resetReading]);

  const jumpToWord = useCallback((nextIndex) => {
    if (wordsRef.current.length === 0) {
      return;
    }

    const lastIndex = wordsRef.current.length - 1;
    const safeIndex = clamp(nextIndex, 0, lastIndex);

    wordIndexRef.current = safeIndex;
    setWordIndex(safeIndex);

    if (safeIndex >= lastIndex) {
      setIsPlaying(false);
      return;
    }

    nextWordTimeRef.current =
      performance.now() + getWordDelay(wordsRef.current[safeIndex], wpmRef.current);
  }, []);

  const jumpBy = useCallback(
    (amount) => {
      jumpToWord(wordIndexRef.current + amount);
    },
    [jumpToWord]
  );

  const editText = useCallback(() => {
    setIsReaderMode(false);
    setIsPlaying(false);
    setIsEditingText(true);
    setIsToolbarVisible(true);
  }, []);

  const exitReaderMode = useCallback(() => {
    setIsReaderMode(false);
    setIsPlaying(false);
    setIsEditingText(true);
    setIsToolbarVisible(true);
  }, []);

  const scheduleToolbarHide = useCallback(() => {
    if (toolbarTimerRef.current !== null) {
      window.clearTimeout(toolbarTimerRef.current);
    }

    if (!isReaderMode) {
      setIsToolbarVisible(true);
      return;
    }

    toolbarTimerRef.current = window.setTimeout(() => {
      if (!toolbarHasFocusRef.current) {
        setIsToolbarVisible(false);
      }
    }, TOOLBAR_HIDE_DELAY_MS);
  }, [isReaderMode]);

  const showToolbar = useCallback(() => {
    setIsToolbarVisible(true);
    scheduleToolbarHide();
  }, [scheduleToolbarHide]);

  const keepToolbarVisible = useCallback(() => {
    toolbarHasFocusRef.current = true;
    setIsToolbarVisible(true);

    if (toolbarTimerRef.current !== null) {
      window.clearTimeout(toolbarTimerRef.current);
    }
  }, []);

  const releaseToolbar = useCallback(
    (event) => {
      const nextTarget = event.relatedTarget;

      if (!nextTarget || !event.currentTarget.contains(nextTarget)) {
        toolbarHasFocusRef.current = false;
        scheduleToolbarHide();
      }
    },
    [scheduleToolbarHide]
  );

  useEffect(() => {
    wordsRef.current = words;
  }, [words]);

  useEffect(() => {
    wordIndexRef.current = wordIndex;
  }, [wordIndex]);

  useEffect(() => {
    wpmRef.current = wpm;
  }, [wpm]);

  useEffect(() => {
    saveSettings({
      hasWords: words.length > 0,
      loadedFileName,
      theme,
      text,
      wordIndex,
      wpm
    });
  }, [loadedFileName, text, theme, wordIndex, words.length, wpm]);

  useEffect(() => {
    showToolbar();

    window.addEventListener("mousemove", showToolbar);
    window.addEventListener("keydown", showToolbar);
    window.addEventListener("touchstart", showToolbar);

    return () => {
      window.removeEventListener("mousemove", showToolbar);
      window.removeEventListener("keydown", showToolbar);
      window.removeEventListener("touchstart", showToolbar);

      if (toolbarTimerRef.current !== null) {
        window.clearTimeout(toolbarTimerRef.current);
      }
    };
  }, [showToolbar]);

  useEffect(() => {
    if (!isPlaying || wordsRef.current.length === 0) {
      return;
    }

    if (wordIndexRef.current >= wordsRef.current.length - 1) {
      setIsPlaying(false);
      return;
    }

    const now = performance.now();
    nextWordTimeRef.current =
      now + getWordDelay(wordsRef.current[wordIndexRef.current], wpmRef.current);

    function tick(currentTime) {
      if (currentTime >= nextWordTimeRef.current) {
        const lastIndex = wordsRef.current.length - 1;
        const nextIndex = Math.min(wordIndexRef.current + 1, lastIndex);

        wordIndexRef.current = nextIndex;
        setWordIndex(nextIndex);

        if (nextIndex >= lastIndex) {
          setIsPlaying(false);
          return;
        }

        const nextDelay = getWordDelay(wordsRef.current[nextIndex], wpmRef.current);

        // Advance from the planned deadline, not from this frame's actual time.
        nextWordTimeRef.current += nextDelay;

        // If the tab stalls, avoid rapidly burning through words to catch up.
        if (currentTime - nextWordTimeRef.current > LATE_FRAME_RESET_MS) {
          nextWordTimeRef.current = currentTime + nextDelay;
        }
      }

      frameIdRef.current = requestAnimationFrame(tick);
    }

    frameIdRef.current = requestAnimationFrame(tick);

    return () => {
      if (frameIdRef.current !== null) {
        cancelAnimationFrame(frameIdRef.current);
      }
    };
  }, [isPlaying, words]);

  useEffect(() => {
    function handleKeyDown(event) {
      const interactiveElement = ["BUTTON", "INPUT", "SELECT", "TEXTAREA"].includes(
        event.target.tagName
      );

      if (event.code === "Escape" && isReaderMode) {
        event.preventDefault();
        exitReaderMode();
        return;
      }

      if (event.code === "Space" && !interactiveElement) {
        event.preventDefault();
        togglePlay();
      }

      if (event.code === "ArrowLeft" && !interactiveElement) {
        event.preventDefault();
        jumpBy(-JUMP_WORD_COUNT);
      }

      if (event.code === "ArrowRight" && !interactiveElement) {
        event.preventDefault();
        jumpBy(JUMP_WORD_COUNT);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [exitReaderMode, isReaderMode, jumpBy, togglePlay]);

  return (
    <main
      className={`app ${isReaderMode ? "reader-mode" : ""}`}
      data-theme={theme}
    >
      <section className="reader">
        <div className="word-display" aria-live="polite">
          <span
            key={`${wordIndex}-${currentWord}`}
            className="word-text"
            aria-label={currentWord}
          >
            <span className="orp-left" aria-hidden="true">
              {currentWordParts.before}
            </span>
            <span className="orp-highlight" aria-hidden="true">
              {currentWordParts.highlight}
            </span>
            <span className="orp-right" aria-hidden="true">
              {currentWordParts.after}
            </span>
          </span>
        </div>
      </section>

      <section
        className={`controls ${
          isToolbarVisible || !isReaderMode ? "is-visible" : ""
        } ${isReaderMode ? "is-reader-mode" : ""} ${
          !isEditingText && words.length > 0 ? "is-reading-mode" : ""
        }`}
        aria-label="Speed reader controls"
        onFocusCapture={keepToolbarVisible}
        onBlurCapture={releaseToolbar}
      >
        <div className="controls-meta">
          <span>{isPlaying ? "Reading" : "Paused"}</span>
          <span>
            {words.length > 0
              ? `Index ${wordIndex} (${wordIndex + 1} / ${words.length})`
              : loadedFileName || "No file loaded"}
          </span>
        </div>

        {isEditingText && (
          <textarea
            value={text}
            onChange={handleTextChange}
            placeholder="Paste text here..."
          />
        )}

        <div className="control-row">
          <input
            ref={fileInputRef}
            className="file-input"
            type="file"
            accept=".txt,text/plain"
            onChange={loadTextFile}
          />
          <button type="button" onClick={() => fileInputRef.current?.click()}>
            Load .txt
          </button>
          {!isEditingText && words.length > 0 && (
            <button className="small-button" type="button" onClick={editText}>
              Edit Text
            </button>
          )}
          <button type="button" onClick={startReading}>
            Start
          </button>
          <button type="button" onClick={togglePlay}>
            {isPlaying ? "Pause" : "Play"}
          </button>
          <button
            type="button"
            onClick={() => jumpBy(-JUMP_WORD_COUNT)}
            disabled={words.length === 0}
          >
            Rewind 10
          </button>
          <button
            type="button"
            onClick={() => jumpBy(JUMP_WORD_COUNT)}
            disabled={words.length === 0}
          >
            Forward 10
          </button>
        </div>

        <div className="settings-row">
          <label className="slider-label">
            <span>{wpm} WPM</span>
            <input
              type="range"
              min="100"
              max="800"
              step="25"
              value={wpm}
              onChange={(event) => setWpm(Number(event.target.value))}
            />
          </label>

          <label className="theme-label">
            <span>Theme</span>
            <select
              value={theme}
              onChange={(event) => setTheme(event.target.value)}
            >
              {THEME_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="progress-control">
          <span>Progress</span>
          <strong>{progress}%</strong>
          <input
            className="progress-slider"
            type="range"
            min="1"
            max={Math.max(words.length, 1)}
            value={words.length > 0 ? wordIndex + 1 : 1}
            disabled={words.length === 0}
            onChange={(event) => jumpToWord(Number(event.target.value) - 1)}
            style={{ "--progress": `${progress}%` }}
          />
        </label>
      </section>
    </main>
  );
}
