import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { DEFAULT_SOURCE, serviceOf } from '../utils/services';
import AddToPlaylist from './AddToPlaylist';
import { PLACEHOLDER_ART, listArtOf } from '../utils/artwork';
import { useMusic } from '../context/hook';
import { toast } from '../utils/toast';
import {
    createFlash, formatTime, likeLabel, likeToast, QUEUED_MS, queueToast, sameTrack, toggleLike
} from '../utils/ui';

// Rows and cards render the normalised Track / Playlist shapes from the
// library API. Where older rows (history, custom playlists written before
// Stage 0) still carry legacy field names, the small helpers below accept both.
const artistOf = (t) => t.artist || t.channelTitle || 'Unknown Artist';

// Drawn locally (utils/artwork.js); no request to a placeholder service.
const PLACEHOLDER_50 = PLACEHOLDER_ART;
const PLACEHOLDER_150 = PLACEHOLDER_ART;

// What has been liked or unliked during this session, so every like button
// for the same track (its row, the player bar) shows the same heart. The API
// does not say which tracks are liked, so a track starts as "not liked"
// unless the screen knows better (the Liked Songs list).
const likedNow = new Map(); // "source:id" -> boolean
const likeListeners = new Set();
const likeKey = (track) => `${track.source || DEFAULT_SOURCE}:${track.id || track.videoId}`;
function setLiked(track, value) {
    likedNow.set(likeKey(track), value);
    likeListeners.forEach((fn) => fn());
}
function subscribeLikes(fn) {
    likeListeners.add(fn);
    return () => likeListeners.delete(fn);
}
function useLiked(track, initiallyLiked) {
    const key = likeKey(track);
    const known = useSyncExternalStore(subscribeLikes, () => likedNow.get(key));
    return known === undefined ? Boolean(initiallyLiked) : known;
}

// A state that shows for a moment ("✓ Queued"): the timer is dropped when the
// component goes away.
function useFlash(ms) {
    const [on, setOn] = useState(false);
    const [flash] = useState(() => createFlash(setOn, ms));
    useEffect(() => () => flash.cancel(), [flash]);
    return [on, flash.trigger];
}

// Inline markers a row can carry: an attribution link for sources whose terms
// require crediting them (declared in the registry), plus the preview /
// not-streamable states some sources report.
const TrackBadges = ({ track }) => {
    if (!track) return null;
    const service = serviceOf(track.source || DEFAULT_SOURCE);
    const badges = [];
    // Sources whose terms require crediting them get a link back.
    if (service.attribution) {
        badges.push(
            <a
                key="attr"
                className="badge is-link"
                href={track.permalinkUrl || service.attribution.url}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                aria-label={`Open on ${service.attribution.text}`}
                style={{ color: service.text }}
            >
                {service.attribution.text} ↗
            </a>
        );
    }
    if (track.preview) {
        badges.push(
            <span key="preview" className="badge is-preview" tabIndex={0} data-tip={`${service.label} plays a 30-second preview of this track.`} data-tip-pos="end">
                Preview
            </span>
        );
    }
    if (track.playable === false) {
        badges.push(<span key="blocked" className="badge is-blocked">Not streamable</span>);
    }
    if (badges.length === 0) return null;
    return <span className="track-row-badges">{badges}</span>;
};

// Heart toggle. Likes, or unlikes once liked (the same track in another row
// or in the player bar follows). `onLike` / `onUnlike` make the calls; without
// `onUnlike` a liked heart stays put. Pops when it becomes liked.
export const LikeButton = ({ track, onLike, onUnlike, initiallyLiked = false, className = '' }) => {
    const liked = useLiked(track, initiallyLiked);
    const [busy, setBusy] = useState(false);
    const [pops, setPops] = useState(0); // a new key replays the pop animation
    if (!onLike && !onUnlike) return null;
    const label = likeLabel(liked);

    const handle = async (e) => {
        e.stopPropagation();
        if (busy) return;
        setBusy(true);
        try {
            const now = await toggleLike({ liked, track, onLike, onUnlike });
            setLiked(track, now);
            if (now) setPops((n) => n + 1);
            toast(likeToast(now));
        } catch (err) {
            toast(err.message || 'That did not work. Try again.', { kind: 'error' });
        } finally {
            setBusy(false);
        }
    };

    return (
        <button
            type="button"
            className={`icon-btn like-btn pressable${liked ? ' is-liked' : ''} ${className}`}
            onClick={handle}
            aria-label={label}
            aria-pressed={liked}
            data-tip={label}
            disabled={busy}
        >
            <span key={pops} className={pops ? 'pop' : undefined} aria-hidden="true">{liked ? '♥' : '♡'}</span>
        </button>
    );
};

// "+ Queue" in a track row: shows "✓ Queued" for a moment after adding.
const QueueButton = ({ track, onQueue }) => {
    const [queued, flash] = useFlash(QUEUED_MS);
    const add = (e) => {
        e.stopPropagation();
        onQueue(track);
        flash();
        toast(queueToast(track.title));
    };
    return (
        <button
            type="button"
            className={`queue-btn pressable${queued ? ' is-queued' : ''}`}
            onClick={add}
            aria-label={queued ? 'Queued' : 'Add to queue'}
            data-tip="Add to the end of your queue"
            data-tip-pos="end"
        >
            <span aria-hidden="true">{queued ? '✓' : '+'}</span>
            <span className="queue-btn-word" aria-hidden="true"> {queued ? 'Queued' : 'Queue'}</span>
        </button>
    );
};

// The cover's overlay: ▶ on hover; on the current track always shown, with
// equaliser bars in the service's colour while it plays.
const CoverOverlay = ({ current, playing, colour }) => (
    <span className={`cover-overlay${current ? ' is-current' : ''}`} aria-hidden="true">
        {current && playing ? (
            <span className="vu-bars" style={{ '--vu-colour': colour }}>
                <span className="vu" /><span className="vu" style={{ animationDelay: '-.3s' }} /><span className="vu" style={{ animationDelay: '-.6s' }} />
            </span>
        ) : '▶'}
    </span>
);

//  LIST ROW
// The cover, title and service line are one button that plays the track (or
// pauses it, if it is the one playing). Actions show on hover or focus.
export const TrackRow = ({ track, onPlay, onQueue, onLike, onUnlike, likedInitially = false, canAddToPlaylist = false, imageSize = 50 }) => {
    const { currentTrack, isPlaying, togglePlay } = useMusic();
    const blocked = track.playable === false;
    const service = serviceOf(track.source || DEFAULT_SOURCE);
    const current = sameTrack(track, currentTrack, DEFAULT_SOURCE);
    const playing = current && isPlaying;
    const artist = artistOf(track);
    const play = () => {
        if (blocked) return;
        if (current) togglePlay();
        else onPlay(track);
    };
    const tip = blocked ? 'This track is unavailable right now.' : `${track.title} · ${artist}`;
    const hasActions = !blocked && ((onLike || onUnlike) || canAddToPlaylist || onQueue);

    return (
        // The slot holds the 2px gap, so VirtualList measures it with the row.
        <div className="track-row-slot">
            <div className={`track-row${blocked ? ' is-blocked' : ''}${current ? ' is-current' : ''}`}>
                <span className="track-row-main" data-tip={tip} data-tip-pos="start">
                    <button
                        type="button"
                        className="track-row-play"
                        onClick={play}
                        disabled={blocked}
                        aria-label={blocked ? `${track.title}: unavailable` : `${playing ? 'Pause' : 'Play'} ${track.title}`}
                    >
                        <span className="track-row-cover" style={{ width: imageSize, height: imageSize }}>
                            <img
                                src={listArtOf(track) || PLACEHOLDER_50}
                                loading="lazy"
                                decoding="async"
                                width={imageSize}
                                height={imageSize}
                                alt=""
                                onError={(e) => { e.target.src = PLACEHOLDER_50; }}
                            />
                            {!blocked && <CoverOverlay current={current} playing={playing} colour={service.text} />}
                        </span>
                        <span className="track-row-text">
                            <span className="track-row-title" style={current ? { color: service.text } : undefined}>{track.title}</span>
                            <span className="track-row-sub">
                                <span className="track-row-service" style={{ color: service.text }}>
                                    <span aria-hidden="true">{service.icon}</span> {service.label}
                                </span>
                                <span className="track-row-artist"> · {artist}</span>
                            </span>
                        </span>
                    </button>
                </span>
                <TrackBadges track={track} />
                {hasActions && (
                    <span className="track-row-actions hover-reveal">
                        {(onLike || onUnlike) && <LikeButton track={track} onLike={onLike} onUnlike={onUnlike} initiallyLiked={likedInitially} />}
                        {canAddToPlaylist && <AddToPlaylist track={track} />}
                        {onQueue && <QueueButton track={track} onQueue={onQueue} />}
                    </span>
                )}
                <span className="track-row-duration">{formatTime(track.durationSec)}</span>
            </div>
        </div>
    );
};

// "Add to queue" on a card's picture. The card gives no other sign that it
// worked, so the button shows a tick for a moment.
const QueueAction = ({ track, onQueue }) => {
    const [done, flash] = useFlash(QUEUED_MS);
    const add = (e) => {
        e.stopPropagation(); // not a click on the card, which plays the track
        onQueue(track);
        flash();
        toast(queueToast(track.title));
    };
    return (
        <button type="button" className="card-action pressable" onClick={add} aria-label="Add to queue" data-tip="Add to the end of your queue" data-tip-pos="end">
            {done ? (
                <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M4 10.5l4 4 8-9" />
                </svg>
            ) : (
                <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                    <path d="M3 5h13M3 9h13M3 13h6" />
                    <path d="M12.5 11.5l5 3-5 3z" fill="currentColor" stroke="none" />
                </svg>
            )}
        </button>
    );
};

// GRID CARD
// `canAddToPlaylist` and `onQueue` put two small buttons on the picture's top
// right corner (playlist above queue), shown while the pointer is on the card.
export const TrackCard = ({ track, onClick, onQueue, canAddToPlaylist = false }) => {
    const service = serviceOf(track.source);
    const hasActions = canAddToPlaylist || Boolean(onQueue);
    return (
        <div
            className="track-card"
            onClick={() => onClick(track)}
            style={{ background: '#181818', padding: '15px', borderRadius: '8px', cursor: 'pointer', transition: 'background 0.3s' }}
            onMouseEnter={(e) => e.currentTarget.style.background = '#282828'}
            onMouseLeave={(e) => e.currentTarget.style.background = '#181818'}
        >
            <div className="track-card-art">
                <img
                    src={listArtOf(track) || PLACEHOLDER_150}
                    loading="lazy"
                    decoding="async"
                    alt={track.title}
                    style={{ display: 'block', width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: '4px' }}
                    onError={(e) => { e.target.src = PLACEHOLDER_150; }}
                />
                {hasActions && (
                    <div className="track-card-actions">
                        {canAddToPlaylist && <AddToPlaylist track={track} compact />}
                        {onQueue && <QueueAction track={track} onQueue={onQueue} />}
                    </div>
                )}
            </div>
            <div style={{ fontWeight: 'bold', fontSize: '14px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {track.title}
            </div>
            <div style={{ color: '#b3b3b3', fontSize: '12px', marginTop: '5px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {artistOf(track)}
                {service.attribution && (
                    <span style={{ color: '#666' }}> · {service.label}</span>
                )}
            </div>
        </div>
    );
};

//  PLAYLIST CARD — renders the normalised Playlist shape only.
//  { source, id, kind: 'liked' | 'playlist' | 'custom', name, thumbnail, itemCount, readOnly }
export const PlaylistCard = ({ playlist, onClick }) => {
    const service = serviceOf(playlist.source);
    const isLiked = playlist.kind === 'liked';
    const count = playlist.itemCount != null ? `${playlist.itemCount} ${playlist.itemCount === 1 ? 'song' : 'songs'}` : null;

    let subtitle;
    if (isLiked) subtitle = count ? `${service.label} · ${count}` : service.label;
    else if (playlist.kind === 'custom') subtitle = count || '0 songs';
    else subtitle = count ? `${service.label} · ${count}` : service.label;

    return (
        <div
            onClick={() => onClick(playlist)}
            style={{ background: isLiked ? '#2a1f2f' : '#282828', padding: '15px', borderRadius: '8px', cursor: 'pointer', transition: 'background 0.3s', border: isLiked ? `1px solid ${service.color}55` : '1px solid transparent' }}
            onMouseEnter={(e) => e.currentTarget.style.background = isLiked ? '#3a2a40' : '#3e3e3e'}
            onMouseLeave={(e) => e.currentTarget.style.background = isLiked ? '#2a1f2f' : '#282828'}
        >
            {playlist.thumbnail ? (
                <img src={listArtOf(playlist)} loading="lazy" decoding="async" style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: '4px', marginBottom: '10px' }} alt="playlist cover" />
            ) : (
                <div aria-hidden="true" style={{ width: '100%', aspectRatio: '1', borderRadius: '4px', marginBottom: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '56px', background: isLiked ? `linear-gradient(135deg, ${service.color}66, #111)` : '#1a1a1a', color: isLiked ? 'white' : '#555' }}>
                    {isLiked ? '♥' : service.icon}
                </div>
            )}
            <div style={{ fontWeight: 'bold', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {isLiked && <span style={{ color: service.color, marginRight: '6px' }}>♥</span>}{playlist.name}
            </div>
            <div style={{ fontSize: '12px', color: '#aaa' }}>{subtitle}</div>
        </div>
    );
};
