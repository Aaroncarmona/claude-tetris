'use strict';

/**
 * Módulo WebRTC 100% serverless: emparejamiento manual vía códigos de texto
 * (SDP comprimido en Base64) sin ningún backend ni servicio de señalización.
 * Solo se usan servidores STUN públicos para resolver candidatos ICE
 * (ayuda a atravesar NAT); no hay ningún componente de aplicación en el servidor.
 */
const TetrisRTC = (() => {
  const ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];
  const ICE_GATHER_TIMEOUT = 4000;

  function encode(obj) {
    return btoa(unescape(encodeURIComponent(JSON.stringify(obj))));
  }

  function decode(str) {
    return JSON.parse(decodeURIComponent(escape(atob(str.trim()))));
  }

  function waitForIceGathering(pc) {
    if (pc.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise(resolve => {
      const done = () => {
        pc.removeEventListener('icegatheringstatechange', done);
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(done, ICE_GATHER_TIMEOUT);
      pc.addEventListener('icegatheringstatechange', () => {
        if (pc.iceGatheringState === 'complete') done();
      });
    });
  }

  function attachChannel(channel, { onMessage, onOpen, onClose } = {}) {
    channel.onopen = () => onOpen && onOpen();
    channel.onclose = () => onClose && onClose();
    channel.onerror = () => onClose && onClose();
    channel.onmessage = e => {
      try {
        onMessage && onMessage(JSON.parse(e.data));
      } catch (err) {
        console.error('Mensaje P2P inválido', err);
      }
    };
  }

  function send(channel, data) {
    if (channel && channel.readyState === 'open') {
      channel.send(JSON.stringify(data));
    }
  }

  async function createHost({ onMessage, onOpen, onClose, onStateChange } = {}) {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const channel = pc.createDataChannel('tetris');
    attachChannel(channel, { onMessage, onOpen, onClose });
    if (onStateChange) pc.oniceconnectionstatechange = () => onStateChange(pc.iceConnectionState);

    async function createOfferCode() {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitForIceGathering(pc);
      return encode({ sdp: pc.localDescription.sdp, type: pc.localDescription.type });
    }

    async function acceptAnswerCode(code) {
      const answer = decode(code);
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
    }

    return { pc, channel, createOfferCode, acceptAnswerCode };
  }

  async function createGuest({ onMessage, onOpen, onClose, onStateChange } = {}) {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    let channel = null;
    pc.ondatachannel = e => {
      channel = e.channel;
      attachChannel(channel, { onMessage, onOpen, onClose });
    };
    if (onStateChange) pc.oniceconnectionstatechange = () => onStateChange(pc.iceConnectionState);

    async function acceptOfferAndCreateAnswerCode(code) {
      const offer = decode(code);
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await waitForIceGathering(pc);
      return encode({ sdp: pc.localDescription.sdp, type: pc.localDescription.type });
    }

    return { pc, getChannel: () => channel, acceptOfferAndCreateAnswerCode };
  }

  return { createHost, createGuest, send, encode, decode };
})();
