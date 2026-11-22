window._spSdkReady = false;
window.onSpotifyWebPlaybackSDKReady = function () {
  window._spSdkReady = true;
  window.dispatchEvent(new Event('spotify-sdk-ready'));
};
