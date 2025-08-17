package com.example.chatapp.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.Collections;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;

/**
 * Keeps sessionId -> (room, username) and room -> members.
 */
@Service
public class PresenceService {

    // sessionId -> (roomId, username) stored as a small tuple-like object
    private final ConcurrentMap<String, MemberInfo> sessionMap = new ConcurrentHashMap<>();
    // roomId -> set of usernames
    private final ConcurrentMap<String, Set<String>> roomMembers = new ConcurrentHashMap<>();
    private static final Logger log = LoggerFactory.getLogger(PresenceService.class);




    public MemberInfo removeBySession(String sessionId) {
        MemberInfo info = sessionMap.remove(sessionId);
        if (info != null) {
            Set<String> set = roomMembers.get(info.roomId);
            if (set != null) set.remove(info.username);
        }
        return info;
    }


    public void addMember(String sessionId, String roomIdRaw, String username) {
        if (sessionId == null || roomIdRaw == null || username == null) return;
        String roomId = String.valueOf(roomIdRaw);
        sessionMap.put(sessionId, new MemberInfo(roomId, username));
        Set<String> set = roomMembers.computeIfAbsent(roomId, k -> ConcurrentHashMap.newKeySet());
        set.add(username);
        log.info("PresenceService.addMember session={} room={} user={} -> count={}", sessionId, roomId, username, set.size());
    }

    public Set<String> getMembers(String roomIdRaw) {
        if (roomIdRaw == null) return Collections.emptySet();
        return roomMembers.getOrDefault(String.valueOf(roomIdRaw), Collections.emptySet());
    }

    public static class MemberInfo {
        public final String roomId;
        public final String username;
        public MemberInfo(String roomId, String username) {
            this.roomId = roomId;
            this.username = username;
        }
    }
}