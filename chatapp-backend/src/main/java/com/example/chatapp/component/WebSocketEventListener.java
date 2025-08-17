package com.example.chatapp.component;

import com.example.chatapp.service.PresenceService;
import com.example.chatapp.model.ChatMessage;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.event.EventListener;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.messaging.SessionDisconnectEvent;

@Component
public class WebSocketEventListener {

    private final PresenceService presenceService;
    private final SimpMessagingTemplate simp;

    @Autowired
    public WebSocketEventListener(PresenceService presenceService, SimpMessagingTemplate simp) {
        this.presenceService = presenceService;
        this.simp = simp;
    }

    @EventListener
    public void handleSessionDisconnect(SessionDisconnectEvent event) {
        StompHeaderAccessor sha = StompHeaderAccessor.wrap(event.getMessage());
        String sessionId = sha.getSessionId();
        PresenceService.MemberInfo info = presenceService.removeBySession(sessionId);
        if (info != null) {
            // broadcast LEAVE to the room
            ChatMessage leave = new ChatMessage();
            leave.setSender(info.username);
            leave.setType("LEAVE");
            leave.setContent(info.username + " has left");
            leave.setRoomId(info.roomId);
            simp.convertAndSend("/topic/message", leave);

            // optionally send updated member list to room:
            simp.convertAndSend("/topic/" + info.roomId + "/members", presenceService.getMembers(info.roomId));
        }
    }
}