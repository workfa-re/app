"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";

const FILM_SOURCE = "/media/onboarding/neighborhood-loop-v3.mp4";

/** One muted film, with explicit playback control and a still-image fallback. */
export function OnboardingFilm() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [paused, setPaused] = useState(false);
  const [userStarted, setUserStarted] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [hasPlayed, setHasPlayed] = useState(false);
  const [available, setAvailable] = useState(true);

  useEffect(() => {
    const media = videoRef.current;
    if (!media || !available) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    let visible = true;
    let disposed = false;
    const update = () => {
      const prefersStill = (motion.matches || connection?.saveData) && !userStarted;
      if (paused || prefersStill || document.hidden || !visible) media.pause();
      else void media.play().catch(() => { if (!disposed) setPlaying(false); });
    };
    const observer = new IntersectionObserver(([observation]) => {
      visible = observation.isIntersecting;
      update();
    });
    observer.observe(media);
    motion.addEventListener("change", update);
    document.addEventListener("visibilitychange", update);
    update();
    return () => {
      disposed = true;
      observer.disconnect();
      motion.removeEventListener("change", update);
      document.removeEventListener("visibilitychange", update);
      media.pause();
    };
  }, [available, paused, userStarted]);

  return <>
    <div className="onboarding-film" aria-hidden="true" data-playing={playing} data-ready={hasPlayed}>
      <div className="onboarding-film-stage">
        <Image className="onboarding-film-poster" src="/media/onboarding/neighborhood-loop-poster-v3.jpg" alt="" fill unoptimized priority />
        {FILM_SOURCE && available && <video ref={videoRef} className="onboarding-film-video" src={FILM_SOURCE}
          muted loop playsInline preload="none" tabIndex={-1}
          onPlaying={() => { setHasPlayed(true); setPlaying(true); }} onPause={() => setPlaying(false)} onError={() => { setAvailable(false); setPlaying(false); }} />}
      </div>
    </div>
    {FILM_SOURCE && available && <button type="button" className="onboarding-film-toggle"
      aria-label={playing ? "Animation pausieren" : "Animation abspielen"}
      onClick={() => {
        const media = videoRef.current;
        if (!media) return;
        setUserStarted(true);
        setPaused(playing);
        if (playing) media.pause();
        else void media.play().catch(() => setPlaying(false));
      }}>
      {playing ? <Pause size={15} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}
      <span>{playing ? "Pause" : "Abspielen"}</span>
    </button>}
  </>;
}
