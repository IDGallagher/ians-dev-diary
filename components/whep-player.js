/* /components/whep-player.js  –  WebRTC-HTTP Egress Protocol (WHEP) player
   Usage examples:
     <whep-player url="https://customer-abc.cloudflarestream.com/whep/xyz"></whep-player>
     <whep-player url="https://..." autoplay muted></whep-player>
*/

customElements.define("whep-player", class extends HTMLElement {
  connectedCallback() {
    const url = this.getAttribute("url");
    if (!url) {
      console.warn("<whep-player> missing url attribute");
      this.innerHTML = '<p style="color: red;">Error: WHEP URL is required</p>';
      return;
    }

    const autoplay = this.hasAttribute("autoplay");
    const muted = this.hasAttribute("muted");

    this.innerHTML = `
      <div style="position: relative; width: 100%; max-width: 100%;">
        <video 
          style="width: 100%; max-width: 100%; border-radius: 8px; background: #000;"
          controls 
          ${autoplay ? 'autoplay' : ''} 
          ${muted ? 'muted' : ''}
          playsinline
        ></video>
        <div style="margin-top: 8px;">
          <button class="play-unmute-btn" style="padding: 12px 24px; background: #667eea; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 16px; font-weight: bold;">
            ▶️ Click to Play with Audio
          </button>
          <div class="whep-status" style="display: inline-block; margin-left: 12px; font-size: 0.9em; color: #666;"></div>
        </div>
      </div>
    `;

    const video = this.querySelector('video');
    const status = this.querySelector('.whep-status');
    const playBtn = this.querySelector('.play-unmute-btn');
    
    // Play button - unmute and play
    playBtn.addEventListener('click', () => {
      console.log('Play button clicked');
      video.muted = false;
      video.volume = 1.0;
      
      video.play().then(() => {
        console.log('✅ Playback started successfully!');
        console.log('Video state: muted=', video.muted, 'volume=', video.volume, 'paused=', video.paused);
        playBtn.textContent = '🔊 Playing with Audio';
        playBtn.style.background = '#43a047';
        playBtn.disabled = true;
        
        // Check audio track state
        if (video.srcObject) {
          const audioTracks = video.srcObject.getAudioTracks();
          audioTracks.forEach(track => {
            console.log('Audio track after play:', {
              id: track.id,
              enabled: track.enabled,
              muted: track.muted,
              readyState: track.readyState
            });
          });
        }
      }).catch(err => {
        console.error('❌ Play failed:', err);
        playBtn.textContent = '⚠️ Play failed - try again';
        playBtn.style.background = '#d32f2f';
      });
    });
    
    const retryOnConflict = this.hasAttribute('retry');
    this.playWHEP(url, video, status, retryOnConflict);
  }

  async playWHEP(whepUrl, videoElement, statusElement, retryOn409 = false, attempt = 1) {
    try {
      statusElement.textContent = '🔄 Connecting to stream...';

      // Create RTCPeerConnection with ICE servers
      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' }
        ]
      });

      // Handle incoming media tracks
      let receivedTracks = [];
      let videoTrack = null;
      let audioTrack = null;
      
      pc.ontrack = (event) => {
        console.log('Received track:', event.track.kind, event.track);
        receivedTracks.push(event.track);
        
        if (event.track.kind === 'video') {
          videoTrack = event.track;
        } else if (event.track.kind === 'audio') {
          audioTrack = event.track;
          
          const settings = event.track.getSettings();
          console.log('Audio track settings:', settings);
          console.log('Audio track channelCount:', settings.channelCount || 'UNKNOWN');
          console.log('Audio track sampleRate:', settings.sampleRate || 'UNKNOWN');
          console.log('Audio track readyState:', event.track.readyState);
          console.log('Audio track muted:', event.track.muted);
          console.log('Audio track enabled:', event.track.enabled);
          
          event.track.onmute = () => {
            console.log('Audio track MUTED event fired');
          };
          event.track.onunmute = () => {
            console.log('Audio track UNMUTED event fired - Audio should now flow!');
            console.log('Track settings after unmute:', event.track.getSettings());
          };
          event.track.onended = () => {
            console.log('Audio track ended');
          };
        }
        
        // Wait until we have both tracks, then set up the stream
        if (videoTrack && audioTrack) {
          console.log('🎬 Both video and audio tracks received, setting up stream...');
          
          // Create a new MediaStream with both tracks
          const stream = new MediaStream([videoTrack, audioTrack]);
          
          console.log('Created MediaStream with tracks:', stream.getTracks().map(t => ({
            kind: t.kind,
            id: t.id,
            enabled: t.enabled,
            muted: t.muted,
            readyState: t.readyState
          })));
          
          videoElement.srcObject = stream;
          
          // Ensure audio track is enabled
          audioTrack.enabled = true;
          
          // Try to play
          setTimeout(() => {
            videoElement.play().then(() => {
              console.log('✅ Video playback started');
              console.log('Video element muted:', videoElement.muted);
              console.log('Video element volume:', videoElement.volume);
              console.log('Video element paused:', videoElement.paused);
              
              // Verify the stream in the video element
              if (videoElement.srcObject) {
                const tracks = videoElement.srcObject.getTracks();
                console.log('Video element has', tracks.length, 'tracks:');
                tracks.forEach(t => {
                  console.log(`  - ${t.kind}: enabled=${t.enabled}, muted=${t.muted}, readyState=${t.readyState}`);
                });
              }
              
              statusElement.textContent = '✅ Connected & Playing';
              setTimeout(() => statusElement.textContent = '', 3000);
            }).catch(err => {
              console.error('Autoplay failed:', err);
              statusElement.textContent = '⚠️ Click "Play with Audio" button';
              statusElement.style.color = '#ff9800';
            });
          }, 200);
        }
      };

      // Handle connection state changes
      pc.onconnectionstatechange = () => {
        console.log('Connection state:', pc.connectionState);
        if (pc.connectionState === 'failed') {
          statusElement.textContent = '❌ Connection failed';
          statusElement.style.color = '#d32f2f';
        }
      };

      // Add transceivers for receiving video and audio
      pc.addTransceiver('video', { direction: 'recvonly' });
      
      // Configure audio transceiver for high-quality stereo
      const audioTransceiver = pc.addTransceiver('audio', { 
        direction: 'recvonly'
      });

      // Create SDP offer
      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true
      });
      await pc.setLocalDescription(offer);
      
      // Modify SDP to request stereo and high bitrate
      let sdp = offer.sdp;
      
      // Find the Opus payload type number
      const opusMatch = sdp.match(/a=rtpmap:(\d+) opus\/48000\/2/);
      if (opusMatch) {
        const opusPayload = opusMatch[1];
        // Find and modify the fmtp line for this payload
        const fmtpRegex = new RegExp(`(a=fmtp:${opusPayload} .*)`, 'g');
        sdp = sdp.replace(fmtpRegex, (match) => {
          if (!match.includes('stereo=')) {
            return match + ';stereo=1;sprop-stereo=1;maxaveragebitrate=510000;cbr=1';
          }
          return match;
        });
        console.log('Modified SDP for stereo audio with payload', opusPayload);
      }
      
      // Update the local description with modified SDP
      await pc.setLocalDescription({
        type: 'offer',
        sdp: sdp
      });

      // Send offer to WHEP endpoint
      console.log('Sending WHEP request to:', whepUrl);
      console.log('SDP offer (with stereo):', sdp);
      const response = await fetch(whepUrl, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/sdp'
        },
        body: sdp
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        console.error('WHEP error response:', errorText);
        
        // Retry on 409 if stream is starting up
        if (response.status === 409 && retryOn409 && attempt < 10) {
          statusElement.textContent = `🔄 Waiting for stream to start... (attempt ${attempt})`;
          console.log(`Retrying in 2 seconds (attempt ${attempt}/10)...`);
          await new Promise(resolve => setTimeout(resolve, 2000));
          return this.playWHEP(whepUrl, videoElement, statusElement, retryOn409, attempt + 1);
        }
        
        throw new Error(`WHEP request failed: ${response.status} ${response.statusText}${errorText ? ' - ' + errorText : ''}`);
      }

      // Get SDP answer and set as remote description
      const answerSdp = await response.text();
      console.log('SDP answer from server:', answerSdp);
      
      // Check what audio codecs the server is offering
      const audioLines = answerSdp.split('\n').filter(line => 
        line.includes('m=audio') || line.includes('a=rtpmap') && answerSdp.indexOf(line) > answerSdp.indexOf('m=audio')
      );
      console.log('Audio lines in answer:', audioLines);
      
      await pc.setRemoteDescription({
        type: 'answer',
        sdp: answerSdp
      });

      console.log('WHEP connection established');
      console.log('Peer connection state:', pc.connectionState);
      console.log('ICE connection state:', pc.iceConnectionState);
      console.log('Signaling state:', pc.signalingState);
      
      // Store peer connection for cleanup
      this._pc = pc;
      
    } catch (error) {
      console.error('WHEP playback error:', error);
      statusElement.textContent = `❌ Error: ${error.message}`;
      statusElement.style.color = '#d32f2f';
    }
  }

  disconnectedCallback() {
    // Clean up peer connection when element is removed
    if (this._pc) {
      this._pc.close();
      this._pc = null;
    }
  }
});

