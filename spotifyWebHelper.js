// ==UserScript==
// @name         Like all songs from all my albums
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  Adds missing functionality to open.spotify.com; Like all songs on all your liked albums; Like all songs on a given album;
// @author       You
// @match        https://open.spotify.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=spotify.com
// @run-at       document-start
// @grant       none
// ==/UserScript==

class SpotifyAPI {
  /**
   *
   * @param {{spotifyAppVersion:string, authorization:string, clientToken:string}} credentials
   */
  constructor(credentials) {
    const { spotifyAppVersion, authorization, clientToken } = credentials;
    if (!spotifyAppVersion || !authorization || !clientToken) {
      throw "Mising required fields";
    }

    const bearerParts = authorization.split(" ");
    if (bearerParts.length < 2) {
      throw "Invalid authorization. Should start with 'Bearer'";
    }

    this.accessToken = bearerParts[1];

    /** @type {object as const} */
    this.authHeaders = {
      "accept-language": "en",
      accept: "application/json",
      "app-platform": "WebPlayer",
      "content-type": "application/json;charset=UTF-8",
      "spotify-app-version": spotifyAppVersion,
      authorization: authorization,
      "client-token": clientToken,
    };
  }

  getAccessToken() {
    return this.accessToken;
  }

  getAlbumsInLibrary = async (offset = 0, albums = []) => {
    const chunkSize = 500;
    const url = await this.createFetchLibraryAlbumsUrl(offset, chunkSize);
    const result = await this.doFetch(url);
    const json = await result.json();

    if (json?.data?.me?.library?.albums?.items?.length > 0) {
      const total = json?.data?.me?.library?.albums?.totalCount;
      json?.data?.me?.library?.albums?.items?.forEach((one) =>
        albums.push(one.album._uri.replace("spotify:album:", ""))
      );

      if (albums.length < total) {
        await this.getAlbumsInLibrary(offset + chunkSize, albums);
      }
    }
    return albums;
  };

  createFetchLibraryAlbumsUrl = async (offset, limit) => {
    return await this.createQueryURL(
      "fetchLibraryAlbums",
      { offset, limit },
      `query fetchLibraryAlbums($offset: Int = 0, $limit: Int = 50) {\n  me {\n    library {\n      albums(offset: $offset, limit: $limit) {\n        ... on UserLibraryAlbumPage {\n          __typename\n          pagingInfo {\n            offset\n            limit\n          }\n          items {\n            ... on UserLibraryAlbumResponse {\n              __typename\n              addedAt {\n                isoString\n              }\n              album {\n                ...libraryAlbum\n              }\n            }\n          }\n          totalCount\n        }\n      }\n    }\n  }\n}\n\nfragment libraryAlbum on AlbumResponseWrapper {\n  _uri\n  data {\n    ... on Error {\n      __typename\n    }\n    ... on Album {\n      __typename\n      name\n      artists {\n        items {\n          uri\n          profile {\n            name\n          }\n        }\n      }\n      coverArt {\n        sources {\n          url\n          width\n          height\n        }\n      }\n      date {\n        isoString\n        precision\n      }\n    }\n  }\n}\n`
    );
  };

  createQueryURL = async (operationName, variables, strToHash) => {
    const extensions = await this.getExtensions(strToHash);
    return `https://api-partner.spotify.com/pathfinder/v1/query?operationName=${operationName}&variables=${this.encodeUriObject(
      variables
    )}&extensions=${this.encodeUriObject(extensions)}`;
  };
  encodeUriObject(o) {
    return encodeURIComponent(JSON.stringify(o));
  }

  getExtensions = async (strToHash) => {
    const extensions = {
      persistedQuery: {
        version: 1,
        sha256Hash: await this.create256Hash(strToHash),
      },
    };
    return extensions;
  };

  create256Hash = async (e) => {
    const encoded = new TextEncoder().encode(e);
    const n = await crypto.subtle.digest("SHA-256", encoded);
    return Array.from(new Uint8Array(n))
      .map((e) => e.toString(16).padStart(2, "0"))
      .join("");
  };

  /**
   *
   * @param {string} url
   * @param {'GET'|'POST'|'PUT'|'DELETE'} method
   * @param {*} body
   * @returns
   */
  doFetch = async (url, method = "GET", body = undefined) => {
    /** @type {RequestInit | undefined} **/
    const props = {
      credentials: "include",
      headers: this.authHeaders,
      referrer: "https://open.spotify.com/",
      method: method,
      mode: "cors",
    };
    if (body != null) {
      if (typeof body === "object") {
        props.body = JSON.stringify(body);
      } else {
        props.body = `${body}`;
      }
    }
    return await window.fetch(url, props);
  };

  /**
   *
   * @param {string} albumId
   * @param {number} offset
   * @param {string[]} trackUris
   * @returns
   */
  getAlbumTracks = async (albumId, offset = 0, trackUris = []) => {
    const limit = 500;
    const url = await this.createQueryAlbumTracksUrl(albumId, offset, limit);

    const result = await this.doFetch(url);
    const json = await result.json();

    const { totalCount, items } = json?.data?.albumUnion?.tracks;

    items.forEach((item) => trackUris.push(item.track.uri));
    if (offset + items.length < totalCount) {
      //we need to get the rest
      return await this.getAlbumTracks(albumId, offset + limit, trackUris);
    } else {
      return trackUris;
    }
  };

  /**
   *
   * @param {string} albumId
   * @param {number} offset
   * @param {number} limit
   * @returns
   */
  createQueryAlbumTracksUrl = async (albumId, offset, limit) => {
    return await this.createQueryURL(
      "queryAlbumTracks",
      { uri: `spotify:album:${albumId}`, offset, limit },
      `query queryAlbumTracks($uri: ID!, $offset: Int, $limit: Int) {\n  albumUnion(uri: $uri) {\n    __typename\n    ... on Album {\n      playability {\n        playable\n      }\n      tracks(offset: $offset, limit: $limit) {\n        totalCount\n        items {\n          ...albumTracklistTrack\n        }\n      }\n    }\n  }\n}\n\nfragment albumTracklistTrack on ContextTrack {\n  uid\n  track {\n    saved\n    uri\n    name\n    playcount\n    discNumber\n    trackNumber\n    contentRating {\n      label\n    }\n    relinkingInformation {\n      linkedTrack {\n        __typename\n        ... on Track {\n          uri\n        }\n      }\n    }\n    duration {\n      totalMilliseconds\n    }\n    playability {\n      playable\n    }\n    artists(offset: 0, limit: 20) {\n      items {\n        uri\n        profile {\n          name\n        }\n      }\n    }\n  }\n}\n`
    );
  };

  /**
   *
   * @param {string[]} trackUris
   * @returns
   */
  areTracksInLibrary = async (trackUris = []) => {
    const url = await this.createQueryURL(
      "areTracksInLibrary",
      { uris: trackUris },
      `query areTracksInLibrary($uris: [ID!]!) {\n  tracks(uris: $uris) {\n    ... on Error {\n      __typename\n    }\n    ... on Track {\n      __typename\n      saved\n    }\n  }\n}\n`
    );
    const response = await this.doFetch(url);
    const json = await response.json();
    const unsavedTrackUris = [];
    json.data.tracks.forEach((one, index) => {
      if (one.saved === false) {
        unsavedTrackUris.push(trackUris[index]);
      }
    });
    return unsavedTrackUris;
  };

  /**
   *
   * @param {string[]} uris
   */
  addToLibrary = async (uris) => {
    const extensions = await this.getExtensions(
      "mutation addToLibrary($uris: [String!]!) {\n  addLibraryItems(input: {uris: $uris}) {\n    __typename\n  }\n}\n"
    );
    await this.doFetch(
      "https://api-partner.spotify.com/pathfinder/v1/query",
      "POST",
      { extensions, operationName: "addToLibrary", variables: { uris } }
    );
  };

  /**
   *
   * @param {boolean} skipAlbumsAlreadyProcessed
   * @param {(message:string)=>void} onProgress
   */
  likeAllSongsOnAllAlbums = async (
    skipAlbumsAlreadyProcessed = true,
    onProgress = (message) => {
      console.log(message);
    }
  ) => {
    const allAlbums = await this.getAlbumsInLibrary();

    if (allAlbums.length) {
      const getHandledList = () => {
        if (!skipAlbumsAlreadyProcessed) {
          return [];
        }
        const albumsString = localStorage.getItem("handledAlbums");
        if (albumsString) {
          try {
            return JSON.parse(albumsString);
          } catch (e) {
            console.error("can't parse handled albums", e);
          }
        }
        return [];
      };
      const handleAlbums = getHandledList();
      let a = new Set(handleAlbums);
      let b = new Set(allAlbums);

      const unhandledAlbumsSet = new Set([...b].filter((x) => !a.has(x)));
      const unhandledAlbums = Array.from(unhandledAlbumsSet);
      if (skipAlbumsAlreadyProcessed) {
        localStorage.setItem(
          "unhandledAlbums",
          JSON.stringify(unhandledAlbums)
        );
      }

      if (unhandledAlbums.length > 0) {
        let allTracks = [];
        for (let i = 0; i < unhandledAlbums.length; i++) {
          onProgress(
            `Step 1/3: Analyzing albums: ${i + 1}/${unhandledAlbums.length}`
          );
          const trackUris = await this.getAlbumTracks(unhandledAlbums[i]);
          allTracks = allTracks.concat(trackUris);
        }

        const chunkSize = 50;
        //determine which tracks are in the library
        let totalChunks = Math.floor(allTracks.length / chunkSize) + 1;
        let chunkCounter = 1;
        let unlikedSongs = [];
        for (let i = 0; i < allTracks.length; i += chunkSize) {
          onProgress(
            `Step 2/3: Checking library for songs: batch ${chunkCounter++}/${totalChunks}`
          );
          const chunk = allTracks.slice(i, i + chunkSize);
          const unlikedSongsInChunk = await this.areTracksInLibrary(chunk);
          unlikedSongs = unlikedSongs.concat(unlikedSongsInChunk);
        }

        //add unliked songs to library
        totalChunks = Math.floor(unlikedSongs.length / chunkSize) + 1;
        chunkCounter = 1;
        if (unlikedSongs.length > 0) {
          for (let i = 0; i < unlikedSongs.length; i += chunkSize) {
            onProgress(
              `Step 3/3: Adding songs to library: batch ${chunkCounter++}/${totalChunks}`
            );
            const chunk = unlikedSongs.slice(i, i + chunkSize);
            await this.addToLibrary(chunk);
          }
          onProgress(`Step 3/3: Done.`);
        } else {
          onProgress(`Step 3/3: All songs already in library`);
        }
        if (skipAlbumsAlreadyProcessed) {
          localStorage.setItem(
            "handledAlbums",
            JSON.stringify(handleAlbums.concat(unhandledAlbums))
          );
        }
      } else {
        onProgress("All albums already processed. Nothing to do.");
      }
    } else {
      onProgress("No albums found. Nothing to do.");
    }
  };
}

/////////////////////
/////////////////////
/////////////////////
////UI HELPER
/////////////////////
/////////////////////
/////////////////////

class SpotifyHelper {
  /**
   *
   * @param {SpotifyAPI} api
   */
  constructor(api) {
    /**
     *
     * @type {SpotifyAPI} api
     */
    this.api = api;
    /**
     * Will stay on the page indefinitely
     *  @type {((e:MessageEvent)=>void)[]} */
    this.wsListeners = [];
    /**
     * Will stay be removed from the page whent he URL changes
     * @type {((e:MessageEvent)=>void)[]} */
    this.wsPageListeners = [];
    this.setupWebSocket(this.api.getAccessToken());
    // set onChangeState() listener:
    ["pushState", "replaceState"].forEach((changeState) => {
      // store original values under underscored keys (`window.history._pushState()` and `window.history._replaceState()`):
      window.history["_" + changeState] = window.history[changeState];
      window.history[changeState] = new Proxy(window.history[changeState], {
        apply: (target, thisArg, argList) => {
          setTimeout(() => {
            this.setupPageHandlers();
          }, 500);
          return target.apply(thisArg, argList);
        },
      });
    });
    window.onpopstate = () => {
      setTimeout(() => {
        this.setupPageHandlers();
      }, 500);
    };

    this.setupPageHandlers();
  }

  setupPageHandlers = () => {
    this.wsPageListeners = [];
    if (location.href.startsWith("https://open.spotify.com/album/")) {
      this.setupLikeAlbumTracks();
    } else if (location.href === "https://open.spotify.com/collection/tracks") {
      this.setupLikeAllSongsOnAllAlbums();
    }
  };

  setupLikeAllSongsOnAllAlbums = async () => {
    if (location.href === "https://open.spotify.com/collection/tracks") {
      const libraryTitleDiv = document.querySelector(
        '[data-testid="creator-link"]'
      ).parentElement?.parentElement?.parentElement;

      if (!libraryTitleDiv?.parentNode?.lastChild) {
        setTimeout(() => {
          this.setupLikeAllSongsOnAllAlbums();
        }, 300);
        return;
      }

      const divToUpdate = document.createElement("div");
      divToUpdate.style.marginLeft = "10px";

      libraryTitleDiv.appendChild(divToUpdate);

      divToUpdate.innerText = "Analyzing albums..";
      const allAlbums = await this.api.getAlbumsInLibrary();

      if (allAlbums.length) {
        const getHandledList = () => {
          const albumsString = localStorage.getItem("handledAlbums");
          if (albumsString) {
            try {
              return JSON.parse(albumsString);
            } catch (e) {
              console.error("can't parse handled albums", e);
            }
          }
          return [];
        };
        const setupActions = () => {
          const handledList = getHandledList();
          let a = new Set(handledList);
          let b = new Set(allAlbums);

          const noLongerLikedSet = new Set([...a].filter((x) => !b.has(x)));
          if (noLongerLikedSet.size > 0) {
            const updatedHandledList = JSON.stringify(
              handledList.filter((x) => !noLongerLikedSet.has(x))
            );
            localStorage.setItem("handledAlbums", updatedHandledList);
          }

          const unhandledAlbumsSet = new Set([...b].filter((x) => !a.has(x)));
          const unhandledAlbums = Array.from(unhandledAlbumsSet);
          divToUpdate.innerHTML = `${a.size - noLongerLikedSet.size}/${
            allAlbums.length
          } albums have songs liked&nbsp;&nbsp;`;

          if (unhandledAlbums.length > 0) {
            const likeAllEl = document.createElement("a");
            likeAllEl.href = "#";
            // likeAllEl.variation = "primary";
            // likeAllEl.icon = "navigation-arrow-left";
            likeAllEl.innerText = "Add missing";
            likeAllEl.onclick = async (e) => {
              e.preventDefault();
              e.stopPropagation();
              likeAllEl.remove();
              await this.api.likeAllSongsOnAllAlbums(true, (message) => {
                divToUpdate.innerText = message;
              });
              setupActions();
            };

            divToUpdate.appendChild(likeAllEl);
          }
        };
        setupActions();
      }
    }
  };

  /**
   *
   * @param {string} accessToken
   */
  setupWebSocket = (accessToken) => {
    this.ws = new WebSocket(
      `wss://guc3-dealer.spotify.com/?access_token=${accessToken}`
    );
    this.ws.onopen = () => {
      this.ws.addEventListener("message", (e) => {
        [...this.wsListeners, ...this.wsPageListeners].forEach((oneListener) =>
          oneListener(e)
        );
      });
      const PING_MS = 90000;
      const sendPing = () => {
        if (this.ws.readyState === this.ws.OPEN) {
          this.ws.send('{"type":"ping"}');
          setTimeout(() => sendPing(), PING_MS);
        } else if (this.ws.readyState === this.ws.CLOSED) {
          this.setupWebSocket(accessToken);
        }
      };
      setTimeout(() => sendPing(), PING_MS);

      this.ws.onerror = (e) => {
        console.error("WS ERROR", e);
        this.setupWebSocket(accessToken);
      };

      this.ws.onclose = () => {
        //the WS should likely get re-opened by the ping timeouts
        //but as a fallback, we can use this onclose to reopen it,
        //we'll wait 15 seconds longer than a ping timeout as a safet
        setTimeout(() => {
          if (this.ws.readyState === ws.CLOSED) {
            this.setupWebSocket(accessToken);
          }
        }, PING_MS + 15000);
      };
    };
  };

  setupLikeAlbumTracks = async () => {
    if (!location.href.startsWith("https://open.spotify.com/album/")) {
      //we might have went to a new url after a settimeout
      return;
    }

    const libraryTitleDiv = document.querySelector(
      '[data-testid="creator-link"]'
    ).parentElement?.parentElement?.parentElement;

    if (!libraryTitleDiv) {
      setTimeout(() => {
        this.setupLikeAlbumTracks();
      }, 300);
      return;
    }

    const divToUpdate = document.createElement("div");
    divToUpdate.style.marginLeft = "10px";

    libraryTitleDiv.appendChild(divToUpdate);

    let likedSongsDiv = document.getElementById("likedSongs");
    if (!likedSongsDiv) {
      likedSongsDiv = document.createElement("div");
      likedSongsDiv.id = "likedSongs";
      divToUpdate.appendChild(likedSongsDiv);
    }
    likedSongsDiv.innerText = "analyzing album..";

    const albumId = location.href
      .replace("https://open.spotify.com/album/", "")
      .split("?")[0]
      .replace("/", "");

    const trackUris = await this.api.getAlbumTracks(albumId);

    const analayzeAlbumTracks = async () => {
      const getLikedString = (liked, total) => {
        return `LIKED ${liked}/${total}`;
      };
      likedSongsDiv.innerText = "analyzing album..";
      const unlikedSongs = await this.api.areTracksInLibrary(trackUris);

      likedSongsDiv.innerText = `${getLikedString(
        trackUris.length - unlikedSongs.length,
        trackUris.length
      )}${unlikedSongs.length ? "   " : ""}`;
      if (unlikedSongs.length > 0) {
        const likeAllEl = document.createElement("a");
        likeAllEl.href = "#";
        likeAllEl.innerText =
          "Like " +
          unlikedSongs.length +
          " song" +
          (unlikedSongs.length > 1 ? "s" : "");
        likeAllEl.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.api.addToLibrary(unlikedSongs).then(() => {
            likedSongsDiv.innerText = getLikedString(
              trackUris.length,
              trackUris.length
            );
          });
        };
        likedSongsDiv.appendChild(likeAllEl);
      }
    };
    await analayzeAlbumTracks();

    this.wsListeners.push((messageEvent) => {
      try {
        if (
          typeof messageEvent.data === "string" &&
          messageEvent.data.includes("text/plain") &&
          messageEvent.data.includes("track")
        ) {
          const data = JSON.parse(messageEvent.data);
          const tracksAffected = [];
          if (data.type === "message" && data["payloads"]?.length > 0) {
            data.payloads.forEach((one) => {
              const payload = JSON.parse(one);
              if (payload.items?.length > 0) {
                payload.items.forEach((item) => {
                  if (item.type === "track" && item.identifier) {
                    tracksAffected.push("spotify:track:" + item.identifier);
                  }
                });
              }
            });

            if (
              tracksAffected.length &&
              trackUris.find((uri) => tracksAffected.includes(uri))
            ) {
              //this track is in the current album
              analayzeAlbumTracks();
            }
          }
        }
      } catch (e) {
        console.error("error parsing WS message", e, messageEvent);
      }
    });
  };
}

async function getCredentials() {
  return new Promise((resolve) => {
    const { fetch: origFetch } = window;
    window.fetch = overrideFetch;

    let found = false;
    async function overrideFetch(...args) {
      const response = await origFetch(...args);
      try {
        if (args && args.length) {
          if (args[0] && typeof args[0] === "string") {
            if (
              args[0].startsWith(
                "https://api-partner.spotify.com/pathfinder"
              ) &&
              args.length > 1 &&
              typeof args[1] === "object" &&
              "headers" in args[1]
            ) {
              if (!found) {
                found = true;
                window.fetch = origFetch;
                //store the auth headers
                const {
                  "spotify-app-version": spotifyAppVersion,
                  authorization,
                  "client-token": clientToken,
                } = args[1]["headers"];
                resolve({ spotifyAppVersion, authorization, clientToken });
              }
            }
          }
        }
      } catch (e) {
        console.error(e);
      }
      return response;
    }
  });
}

(function () {
  "use strict";
  getCredentials().then((credentials) => {
    new SpotifyHelper(new SpotifyAPI(credentials));
  });
})();
