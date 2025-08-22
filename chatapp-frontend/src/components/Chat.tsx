import React,{useState,useRef, useEffect} from 'react';
import SockJS from 'sockjs-client';
import { Client } from '@stomp/stompjs';
import { PaperAirplaneIcon, UserPlusIcon, MinusIcon, ExclamationCircleIcon } from '@heroicons/react/24/outline';
interface ChatProps {
    username: string;
    roomId?: string | number;
    onLogout?: () => void;
}

type MessageItem = {
    cid?: string;
    sender?: string;
    content?: string;
    raw?: string;
    type?: string;
    isLocal?: boolean;
    recalled?: boolean;
    edited?: boolean;
    flagged?: boolean;
    polite?: boolean;
    revealed?: boolean;
}

const makeClientId = () => {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
        try { return (crypto as any).randomUUID(); } catch (e) {}
    }
    return Date.now().toString(36) + Math.random().toString(36).slice(2,8);
};

const extractCid = (raw: string | undefined) => {
    if (!raw) return { cid: undefined, content: raw };
    // original used /s flag; replace with [\s\S] for compatibility
    const m = raw.match(/^\[cid:([^\]]+)\]([\s\S]*)$/);
    if (m) return { cid: m[1], content: m[2] };
    const mr = raw.match(/^\[recalled:([^\]]+)\]$/);
    if (mr) return { cid: mr[1], content: undefined };
    return { cid: undefined, content: raw };
};

const Chat: React.FC<ChatProps> = ({ username, roomId, onLogout}) => {
    const [messages, setMessages] = useState<MessageItem[]>([]);
    const [message, setMessage] = useState<string>('');
    const [stompClient, setStompClient] = useState<Client | null>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    // track last sent by cid to dedupe server echo
    const lastSentRef = useRef<{ cid?: string; ts: number } | null>(null);

    // member list state
    const [members, setMembers] = useState<string[]>([]);
    const [showMembers, setShowMembers] = useState<boolean>(false);

    // menu state for ellipsis (which message's menu is open)
    const [openMenuCid, setOpenMenuCid] = useState<string | undefined>(undefined);
    // editing state
    const [editingCid, setEditingCid] = useState<string | undefined>(undefined);
    const [editingText, setEditingText] = useState<string>('');

    // normalize room id to string for comparisons
    const currentRoom = roomId !== undefined && roomId !== null ? String(roomId) : null;

    // Yêu cầu backend gửi lại danh sách thành viên
    const requestMembersList = () => {
        if (stompClient && currentRoom) {
            stompClient.publish({
                destination: '/app/requestMembers',
                body: JSON.stringify({ roomId: currentRoom })
            });
        }
    };

    const addMember = (name: string) => {
        if (!name) return;
        setMembers((prev) => (prev.includes(name) ? prev : [...prev, name]));
    };
    const removeMember = (name: string) => {
        if (!name) return;
        setMembers((prev) => prev.filter((m) => m !== name));
    };

    const sendMessage = () => {
        if (message.trim() && stompClient) {
            const cid = makeClientId();
            const rawContent = `[cid:${cid}]${message}`;
            const chatMessage = {
                sender: username,
                content: rawContent,
                type: 'CHAT',
                roomId: currentRoom,
            };

            // optimistic UI: append locally so user sees message immediately
            lastSentRef.current = { cid, ts: Date.now() };
            setMessages((prev) => [...prev, { cid, sender: username, content: message, raw: rawContent, type: 'CHAT', isLocal: true }] );

            stompClient.publish({ destination: '/app/sendMessage', body: JSON.stringify(chatMessage) });
            setMessage('');
            inputRef.current?.focus();
        }
    };

    const recallMessage = (cid?: string) => {
        if (!cid || !stompClient) return;
        const recallPayload = {
            sender: username,
            content: `[recalled:${cid}]`,
            type: 'RECALL',
            roomId: currentRoom,
        };
        // optimistically mark recalled locally
        setMessages((prev) => prev.map(m => m.cid === cid ? { ...m, recalled: true } : m));
        try {
            stompClient.publish({ destination: '/app/sendMessage', body: JSON.stringify(recallPayload) });
        } catch (e) {
            console.error('publish recall error', e);
        }
    };

    const deleteMessage = (cid?: string) => {
        if (!cid) return;
        // optimistic local remove
        setMessages((prev) => prev.filter(m => m.cid !== cid));
        if (!stompClient) return;
        const payload = {
            sender: username,
            content: `[deleted:${cid}]`,
            type: 'DELETE',
            roomId: currentRoom,
        };
        try {
            stompClient.publish({ destination: '/app/sendMessage', body: JSON.stringify(payload) });
        } catch (e) {
            console.error('publish delete error', e);
        }
    };

    const startEdit = (cid?: string) => {
        if (!cid) return;
        const msg = messages.find(m => m.cid === cid);
        if (!msg) return;
        setEditingCid(cid);
        setEditingText(msg.content || '');
        setOpenMenuCid(undefined);
    };

    const cancelEdit = () => {
        setEditingCid(undefined);
        setEditingText('');
    };

    const saveEdit = async (cid?: string) => {
        if (!cid || !stompClient) return;
        const newText = editingText.trim();
        if (!newText) return;
        // optimistically update local message
        setMessages((prev) => prev.map(m => m.cid === cid ? { ...m, content: newText, edited: true } : m));
        // send EDIT payload: [edited:CID]new content
        const payload = {
            sender: username,
            content: `[edited:${cid}]${newText}`,
            type: 'EDIT',
            roomId: currentRoom,
        };
        try {
            stompClient.publish({ destination: '/app/sendMessage', body: JSON.stringify(payload) });
        } catch (e) {
            console.error('publish edit error', e);
        }
        setEditingCid(undefined);
        setEditingText('');
    };

    const handleLogout = () => {
        try {
            if (stompClient) {
                try {
                    const leaveMsg = {
                        sender: username,
                        content: username + ' has left',
                        type: 'LEAVE',
                        roomId: currentRoom,
                    };
                    stompClient.publish({ destination: '/app/sendMessage', body: JSON.stringify(leaveMsg) });
                } catch (err) {}
            }
        } catch (e) {
            console.error('error during logout notify', e);
        }

        try {
            onLogout?.();
        } catch (e) {
            console.error('Chat: error calling onLogout', e);
        }
    };

    // client-side profanity detection settings
    // Replace profanityList with your actual words locally (do NOT commit offensive words publicly).
    const profanityList = ['badword1', 'badword2', 'foobar'];
    // whitelist words that should never be considered profanity (normalized form)
    const whitelist = ['con', 'anotherwhitelist'];

    // normalize: remove diacritics, lowercase, replace non-letter/number with space
    const normalizeForToken = (s: string) => {
        try {
            // remove combining diacritic marks and non-alphanumeric characters
            return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/gi, ' ').trim();
        } catch (e) {
            return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
        }
    };

    const collapseRepeats = (s: string) => s.replace(/(.)\1{2,}/g, '$1');

    // returns true only if an exact token or exact normalized phrase matches a banned word (not substring)
    const containsProfanity = (text?: string) => {
        if (!text) return false;
        const raw = String(text);
        const normalized = normalizeForToken(raw); // words separated by spaces
        if (!normalized) return false;

        // build token set
        const tokens = Array.from(new Set(normalized.split(/\s+/).filter(Boolean)));

        // check tokens against whitelist first
        const normalizedWhitelist = new Set(whitelist.map(w => w.toLowerCase()));

        // check each banned entry
        for (const entry of profanityList) {
            if (!entry) continue;
            const ne = normalizeForToken(entry);
            if (!ne) continue;

            // if entry is multi-word phrase, check normalized phrase contains it as phrase
            if (ne.includes(' ')) {
                if (normalized.includes(ne)) {
                    // ensure not whitelisted
                    if (!normalizedWhitelist.has(ne)) return true;
                }
                continue;
            }

            // single token: exact token match
            if (tokens.includes(ne) && !normalizedWhitelist.has(ne)) return true;

            // check obfuscated forms (collapsed repeats) as a fallback: collapse raw then normalize and token match
            const collapsed = collapseRepeats(raw.toLowerCase()).replace(/[^a-z0-9]+/g, ' ').trim();
            if (collapsed.includes(ne) && !normalizedWhitelist.has(ne)) return true;
        }

        return false;
    };

    // allow toggling revealed state per message
    const toggleMessageReveal = (cid?: string) => {
        if (!cid) return;
        setMessages(prev => prev.map(m => m.cid === cid ? { ...m, revealed: !m.revealed } : m));
    };

    // global control to reveal all flagged messages without changing each item
    const [showAllFlagged, setShowAllFlagged] = useState<boolean>(false);

    useEffect(() => {
        // create STOMP client using @stomp/stompjs and SockJS transport
        const client = new Client({
            webSocketFactory: () => new SockJS('http://localhost:8080/chat-websocket') as any,
            reconnectDelay: 5000,
            onConnect: (frame) => {
                console.log('STOMP connected', frame);

                // subscribe to private member list destination first so server can send the current members to this session
                try {
                    client.subscribe('/user/queue/members', (m: any) => {
                        if (!m || !m.body) return;
                        try {
                            const list = JSON.parse(m.body);
                            if (Array.isArray(list)) {
                                setMembers(list);
                            }
                        } catch (err) {
                            // ignore parse errors
                        }
                    });
                } catch (err) {
                    console.warn('subscribe to user queue members failed', err);
                }

                // subscribe vào topic broadcast danh sách thành viên cho cả phòng
                if (currentRoom) {
                    client.subscribe(`/topic/${currentRoom}/members`, (m: any) => {
                        if (!m || !m.body) return;
                        try {
                            const list = JSON.parse(m.body);
                            if (Array.isArray(list)) {
                                setMembers(list);
                            }
                        } catch (err) {
                            // ignore parse errors
                        }
                    });
                }

                // then subscribe to global topic
                const subDest = '/topic/message';
                client.subscribe(subDest, (msg: any) => {
                    if (!msg || !msg.body) return;
                    let parsed: any = null;
                    try {
                        parsed = JSON.parse(msg.body);
                    } catch (err) {
                        parsed = { content: msg.body };
                    }

                    const msgRoom = parsed.roomId ?? null;
                    if (currentRoom) {
                        if (msgRoom && String(msgRoom) !== currentRoom) return;
                        if (!msgRoom) return;
                    }

                    const type = (parsed.type || '').toString().toUpperCase();

                    if (type === 'JOIN') {
                        addMember(parsed.sender);
                        requestMembersList();
                    } else if (type === 'LEAVE') {
                        removeMember(parsed.sender);
                        requestMembersList();
                    } else if (type === 'RECALL') {
                        const mr = (parsed.content || '').match(/^\[recalled:([^\]]+)\]$/);
                        if (mr) {
                            const targetCid = mr[1];
                            setMessages((prev) => prev.map(m => m.cid === targetCid ? { ...m, recalled: true } : m));
                        }
                        return;
                    } else if (type === 'DELETE') {
                        const md = (parsed.content || '').match(/^\[deleted:([^\]]+)\]$/);
                        if (md) {
                            const delCid = md[1];
                            // remove message locally
                            setMessages((prev) => prev.filter(m => m.cid !== delCid));
                        }
                        return;
                    } else if (type === 'EDIT') {
                        const me = (parsed.content || '').match(/^\[edited:([^\]]+)\]([\s\S]*)$/);
                        if (me) {
                            const targetCid = me[1];
                            const newContent = me[2] || '';
                            setMessages((prev) => prev.map(m => m.cid === targetCid ? { ...m, content: newContent, edited: true } : m));
                        }
                        return;
                    }

                    const { cid, content } = extractCid(parsed.content);
                    // If backend marks message as impolite, hide by default
                    const isFlagged = parsed.polite === false;
                    const incoming: MessageItem = {
                        cid,
                        sender: parsed.sender,
                        content: content,
                        raw: parsed.content,
                        type: parsed.type,
                        flagged: isFlagged,
                        polite: parsed.polite,
                        revealed: !isFlagged // only show if not flagged
                    };

                    if (cid && lastSentRef.current && lastSentRef.current.cid === cid) {
                        setMessages((prev) => {
                            const idx = prev.findIndex((m) => m.isLocal && m.cid === cid);
                            if (idx >= 0) {
                                const copy = [...prev];
                                copy.splice(idx, 1);
                                return [...copy, { ...incoming, isLocal: false }];
                            }
                            return [...prev, incoming];
                        });
                        lastSentRef.current = null;
                        return;
                    }

                    setMessages((prev) => [...prev, incoming]);
                });

                // now publish JOIN so server will add member and (should) send private members list to this session
                try {
                    const joinMsg = {
                        sender: username,
                        content: username + ' has joined',
                        type: 'JOIN',
                        roomId: currentRoom,
                    };
                    client.publish({ destination: '/app/sendMessage', body: JSON.stringify(joinMsg) });
                    // assume we are a member locally for immediate feedback
                    addMember(username);
                } catch (e) {
                    console.error('publish join error', e);
                }
            },
            onStompError: (frame) => {
                console.error('STOMP error', frame);
            }
        });

        client.activate();
        setStompClient(client);

        return () => {
            try {
                // attempt to notify server we're leaving the room by sending a LEAVE message to /app/sendMessage
                try {
                    const leaveMsg = {
                        sender: username,
                        content: username + ' has left',
                        type: 'LEAVE',
                        roomId: currentRoom,
                    };
                    client.publish({ destination: '/app/sendMessage', body: JSON.stringify(leaveMsg) });
                } catch (err) {
                    // ignore publish errors during teardown
                }
                // remove self from members locally
                removeMember(username);
                client.deactivate();
            } catch (e) {
                console.error('client deactivate error', e);
            }
        };
    }, [username, currentRoom]);

    // scroll to bottom when messages update
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);
    return (
        <div className={`flex justify-center items-center min-h-screen bg-gradient-to-br from-pink-200 via-purple-200 to-blue-200`}>
            <div className='flex flex-col rounded-2xl shadow-2xl w-full sm:w-[29rem] h-[700px] border border-white/30 bg-white/80 backdrop-blur-lg relative animate__animated animate__fadeIn'>
                 {/* Chat Room Header */}
                  <div className='relative p-4 bg-gradient-to-r from-pink-500 via-purple-500 to-blue-500 text-white font-bold text-center rounded-t-2xl shadow-lg'>
                       <div className='absolute right-3 top-3 flex items-center space-x-2'>
                           <div className='text-sm bg-purple-700 px-3 py-1 rounded-full shadow'>Room: {currentRoom ?? '—'}</div>
                           <button aria-label='Show members' title='Show members' onClick={() => setShowMembers(true)} className='p-1 rounded-full hover:bg-pink-600 transition'>
                               <ExclamationCircleIcon className='w-5 h-5 text-white' />
                           </button>
                       </div>
                       <div className='flex items-center justify-center space-x-2'>
                         <span className='text-xl font-extrabold tracking-wide drop-shadow'>Chat Room</span>
                         <span className='text-yellow-300 animate-pulse'>★</span>
                       </div>
                  </div>

                  {/* Members modal */}
                  {showMembers && (
                      <div className='fixed inset-0 bg-black/40 flex items-center justify-center z-40'>
                          <div className='bg-white rounded-2xl w-80 max-h-[60vh] overflow-auto p-4 shadow-2xl border border-purple-200'>
                              <div className='flex justify-between items-center mb-3'>
                                  <h3 className='font-bold text-purple-700'>Members in room</h3>
                                  <button onClick={() => setShowMembers(false)} className='text-sm text-gray-600 hover:text-pink-500'>Close</button>
                              </div>
                              <ul>
                                  {members.length === 0 && <li className='text-sm text-gray-500'>No members yet</li>}
                                  {members.map((m) => (
                                      <li key={m} className='flex items-center justify-between py-1 border-b last:border-b-0'>
                                          <div className='flex items-center space-x-2'>
                                              <div className='w-8 h-8 rounded-full bg-gradient-to-br from-pink-400 via-purple-400 to-blue-400 flex items-center justify-center text-sm font-bold text-white shadow'>{m.split(' ').map(s=>s[0]).slice(0,2).join('').toUpperCase()}</div>
                                              <span className='text-sm font-semibold text-purple-700'>{m}</span>
                                          </div>
                                      </li>
                                  ))}
                              </ul>
                          </div>
                      </div>
                  )}

                  {/* Chat Messages */}
                  <div className='flex-1 overflow-y-auto p-4 flex flex-col justify-end bg-white/60 rounded-b-2xl'>
                      {messages.map((msg, index) => {
                          const type = (msg.type || '').toString().toUpperCase();
                          // system messages (join/leave) show centered small text with icon
                          if (type === 'JOIN' || type === 'LEAVE' || type === 'SYSTEM') {
                              // determine if this event is about the current user; use case-insensitive compare and fallback to content
                              const isSelf = !!(msg.sender && username && msg.sender.toLowerCase() === username.toLowerCase())
                                  || (!!msg.content && username && msg.content.toLowerCase().includes(username.toLowerCase()));
                              let text = msg.content;
                              if (!text) {
                                  if (type === 'JOIN') text = isSelf ? 'Bạn mới vừa vào phòng' : (msg.sender ? `${msg.sender} joined` : 'Someone joined');
                                  if (type === 'LEAVE') text = isSelf ? 'You left' : (msg.sender ? `${msg.sender} left` : 'Someone left');
                              }
                              const Icon = type === 'LEAVE' ? MinusIcon : UserPlusIcon;
                              return (
                                  <div key={index} className='w-full flex justify-center my-2'>
                                      <div className='inline-flex items-center text-sm text-gray-500 bg-transparent space-x-2'>
                                          <Icon className='w-4 h-4 text-gray-500' />
                                          <span>{text}</span>
                                      </div>
                                  </div>
                              );
                          }

                          const isOwn = msg.sender === username;
                          const initials = (msg.sender || '')
                              .split(' ')
                              .map((s: string) => s[0])
                              .join('')
                              .slice(0, 2)
                              .toUpperCase() || '?';

                          // if recalled show small italic text
                          if (msg.recalled) {
                              return (
                                  <div key={index} className={`my-2 flex ${isOwn ? 'justify-end' : 'justify-start'}`}>
                                      <div className='flex items-end space-x-2'>
                                          {!isOwn && <div className='w-8 h-8 rounded-full bg-gray-400 text-white flex items-center justify-center text-sm font-semibold'>{initials}</div>}
                                          <div className='max-w-[70%] p-3 rounded-lg break-words bg-gray-100 text-gray-500 italic'>Message recalled</div>
                                          {isOwn && <div className='w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center text-sm font-semibold'>{initials}</div>}
                                      </div>
                                  </div>
                              );
                          }

                          // Hide message if flagged by backend (polite === false) and not revealed
                          if ((msg.flagged || msg.polite === false) && !msg.revealed) {
                              return (
                                  <div key={index} className={`my-2 flex ${msg.sender === username ? 'justify-end' : 'justify-start'}`}>
                                      <div className='flex items-end space-x-2'>
                                          {msg.sender !== username && <div className='w-8 h-8 rounded-full bg-gray-400 text-white flex items-center justify-center text-sm font-semibold'>{(msg.sender || '').charAt(0).toUpperCase()}</div>}
                                          <div className={`max-w-[70%] p-3 rounded-lg break-words bg-gray-200 text-gray-900`}>
                                              <div className='text-sm text-gray-600 mb-2'>This message is hidden by moderation</div>
                                              <button onClick={() => toggleMessageReveal(msg.cid)} className='px-3 py-1 bg-white border rounded text-sm'>Show message</button>
                                          </div>
                                          {msg.sender === username && <div className='w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center text-sm font-semibold'>{(msg.sender || '').charAt(0).toUpperCase()}</div>}
                                      </div>
                                  </div>
                              );
                          }
                          // If revealed, allow toggling back to hidden
                          if ((msg.flagged || msg.polite === false) && msg.revealed) {
                            return (
                                <div key={index} className={`my-2 flex ${msg.sender === username ? 'justify-end' : 'justify-start'}`}>
                                    <div className='flex items-end space-x-2'>
                                        {msg.sender !== username && <div className='w-8 h-8 rounded-full bg-gray-400 text-white flex items-center justify-center text-sm font-semibold'>{(msg.sender || '').charAt(0).toUpperCase()}</div>}
                                        <div className={`max-w-[70%] p-3 rounded-lg break-words bg-gray-100 text-gray-900`}>
                                            <div className='text-sm text-gray-600 mb-2'>This message is hidden by moderation</div>
                                            <div className='mb-2'>{msg.content}</div>
                                            <button onClick={() => toggleMessageReveal(msg.cid)} className='px-3 py-1 bg-white border rounded text-sm'>Hide message</button>
                                        </div>
                                        {msg.sender === username && <div className='w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center text-sm font-semibold'>{(msg.sender || '').charAt(0).toUpperCase()}</div>}
                                    </div>
                                </div>
                            );
                        }

                          return (
                              <div key={index} className={`my-2 flex ${isOwn ? 'justify-end' : 'justify-start'}`}>
                                  {isOwn ? (
                                      <div className='flex items-end space-x-2 relative'>
                                          <div className={`max-w-[70%] p-3 rounded-lg break-words bg-blue-500 text-white rounded-br-none relative`}>
                                              {editingCid === msg.cid ? (
                                                  <div className='flex flex-col space-y-2'>
                                                       <input value={editingText} onChange={(e) => setEditingText(e.target.value)} className='w-full p-2 rounded text-black' />
                                                       <div className='flex justify-end space-x-2'>
                                                           <button onClick={() => cancelEdit()} className='px-2 py-1 text-sm bg-gray-200 rounded'>Cancel</button>
                                                           <button onClick={() => saveEdit(msg.cid)} className='px-2 py-1 text-sm bg-green-600 text-white rounded'>Save</button>
                                                       </div>
                                                   </div>
                                               ) : (
                                                   <>
                                                      <div>{msg.content} {msg.edited && <span className='text-xs text-white/80 ml-2'>(edited)</span>}</div>
                                                   </>
                                               )}
                                          </div>
                                          <div className='w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center text-sm font-semibold'>
                                              {initials}
                                          </div>
                                          {/* ellipsis menu trigger */}
                                          <div className='relative'>
                                              <button onClick={() => setOpenMenuCid(openMenuCid === msg.cid ? undefined : msg.cid)} className='ml-2 text-gray-500 hover:text-gray-700'>⋯</button>
                                              {openMenuCid === msg.cid && (
                                                  <div className='absolute right-0 mt-2 w-40 bg-white border rounded shadow z-50'>
                                                      <button onClick={() => { startEdit(msg.cid); }} className='block w-full text-left px-3 py-2 text-sm hover:bg-gray-100'>Edit</button>
                                                      <button onClick={() => { recallMessage(msg.cid); setOpenMenuCid(undefined); }} className='block w-full text-left px-3 py-2 text-sm hover:bg-gray-100'>Recall</button>
                                                      <button onClick={() => { deleteMessage(msg.cid); setOpenMenuCid(undefined); }} className='block w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-gray-100'>Delete</button>
                                                  </div>
                                              )}
                                          </div>
                                      </div>
                                  ) : (
                                      <div className='flex items-end space-x-2'>
                                          <div className='w-8 h-8 rounded-full bg-gray-400 text-white flex items-center justify-center text-sm font-semibold'>
                                              {initials}
                                          </div>
                                          <div className={`max-w-[70%] p-3 rounded-lg break-words bg-gray-200 text-gray-900 rounded-bl-none`}>
                                              <div className='text-sm font-semibold mb-1'>{msg.sender}</div>
                                              <div className=''>{msg.content} {msg.edited && <span className='text-xs text-gray-500 ml-2'>(edited)</span>}</div>
                                          </div>
                                      </div>
                                  )}
                              </div>
                          );
                      })}
                      <div ref={messagesEndRef} />
                  </div>
                  {/* Chat Input */}
                  <div className='p-4 border-t flex items-center space-x-2 bg-gradient-to-r from-pink-100 via-purple-100 to-blue-100 rounded-b-2xl'>
                      <input
                          type='text'
                          ref={inputRef}
                          className='border border-pink-300 rounded-xl p-2 flex-1 bg-white/80 focus:ring-2 focus:ring-purple-300 focus:border-purple-300 shadow'
                          placeholder='Type your message...'
                          value={message}
                          onChange={(e) => setMessage(e.target.value)}
                          onKeyDown={(e) => {
                              if (e.key === 'Enter' && message.trim()) {
                                  sendMessage();
                              }
                          }}
                      />
                      <button
                            className='bg-gradient-to-r from-pink-500 via-purple-500 to-blue-500 text-white rounded-full p-2 ml-2 flex items-center justify-center shadow-lg hover:scale-110 transition duration-200'
                            onClick={sendMessage}
                            aria-label='Send message'
                        >
                            <PaperAirplaneIcon className='w-5 h-5' />
                        </button>
                  </div>
                 {/* Button logout */}
                 <div className='p-4 text-center border-t bg-gradient-to-r from-pink-100 via-purple-100 to-blue-100 rounded-b-2xl'>
                    <button
                        type='button'
                        onClick={() => { handleLogout(); }}
                        className='w-full p-3 bg-gradient-to-r from-pink-500 via-purple-500 to-blue-500 text-white rounded-xl font-bold shadow-lg hover:scale-105 transition-all duration-200'
                    >
                        Logout
                    </button>
                 </div>
            </div>
        </div>
    );
}
export default Chat;