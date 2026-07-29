'use strict';

/**
 * Módulo WebRTC 100% serverless: emparejamiento manual vía códigos de texto
 * (SDP en Base64) sin ningún backend ni servicio de señalización.
 * Solo se usan servidores STUN públicos de Google para resolver candidatos
 * ICE (ayuda a atravesar NAT); no hay ningún componente de aplicación en el
 * servidor. No se usa TURN a propósito: mantenerlo 100% serverless implica
 * que en NAT simétrico/firewalls muy restrictivos la conexión puede fallar.
 */
const TetrisRTC = (() => {
  const ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
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
      let settled = false;
      const onChange = () => {
        if (pc.iceGatheringState === 'complete') done();
      };
      const done = () => {
        if (settled) return;
        settled = true;
        pc.removeEventListener('icegatheringstatechange', onChange);
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(done, ICE_GATHER_TIMEOUT);
      pc.addEventListener('icegatheringstatechange', onChange);
    });
  }

  function attachChannel(channel, { onMessage, onOpen, onClose, onError } = {}) {
    channel.onopen = () => onOpen && onOpen();
    channel.onclose = () => onClose && onClose();
    channel.onerror = e => onError ? onError(e) : (onClose && onClose());
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

  function assertType(desc, expected) {
    if (!desc || desc.type !== expected) {
      throw new Error(`Código inválido: se esperaba un código de tipo "${expected}".`);
    }
    return desc;
  }

  function closePeer(pc, channel) {
    try { if (channel) channel.close(); } catch (e) { /* ya cerrado */ }
    try { if (pc) pc.close(); } catch (e) { /* ya cerrado */ }
  }

  async function createHost({ onMessage, onOpen, onClose, onError, onStateChange } = {}) {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const channel = pc.createDataChannel('tetris', { ordered: true });
    attachChannel(channel, { onMessage, onOpen, onClose, onError });
    if (onStateChange) pc.oniceconnectionstatechange = () => onStateChange(pc.iceConnectionState);

    async function createOfferCode() {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitForIceGathering(pc);
      return encode({ sdp: pc.localDescription.sdp, type: pc.localDescription.type });
    }

    async function acceptAnswerCode(code) {
      const answer = assertType(decode(code), 'answer');
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
    }

    function close() {
      closePeer(pc, channel);
    }

    return { pc, channel, createOfferCode, acceptAnswerCode, close };
  }

  async function createGuest({ onMessage, onOpen, onClose, onError, onStateChange } = {}) {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    let channel = null;
    pc.ondatachannel = e => {
      channel = e.channel;
      attachChannel(channel, { onMessage, onOpen, onClose, onError });
    };
    if (onStateChange) pc.oniceconnectionstatechange = () => onStateChange(pc.iceConnectionState);

    async function acceptOfferAndCreateAnswerCode(code) {
      const offer = assertType(decode(code), 'offer');
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await waitForIceGathering(pc);
      return encode({ sdp: pc.localDescription.sdp, type: pc.localDescription.type });
    }

    function close() {
      closePeer(pc, channel);
    }

    return { pc, getChannel: () => channel, acceptOfferAndCreateAnswerCode, close };
  }

  return { createHost, createGuest, send, encode, decode };
})();
