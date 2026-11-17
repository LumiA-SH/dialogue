import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import RoomCharacterManager from './RoomCharacterManager';
import { supabase } from '../lib/supabase';

jest.mock('../lib/supabase', () => ({ supabase: { from: jest.fn() } }));
jest.mock('./CharacterForm', () => function Form({ onSaved, allowDelete }) {
    return <button onClick={() => onSaved({ character_id: 'new', user_id: 'me', character_name: 'New' })}>{allowDelete === false ? 'save without delete' : 'delete exposed'}</button>;
});

let container, root, props, query;
beforeEach(() => {
    global.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    props = { roomId: 1, userId: 'me', characters: [
        { character_id: 'a', user_id: 'me', character_name: 'Alice' },
        { character_id: 'b', user_id: 'me', character_name: 'Bob' },
        { character_id: 'other', user_id: 'other', character_name: 'Other' }
    ], links: [{ character_id: 'a', is_active: true }, { character_id: 'b', is_active: false }], selected: 'a', onLinksChange: jest.fn(), onSelect: jest.fn(), onCharacterSaved: jest.fn(), onClose: jest.fn() };
    query = { update: jest.fn().mockReturnThis(), insert: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), select: jest.fn().mockReturnThis(), single: jest.fn().mockResolvedValue({ data: { character_id: 'b', is_active: true }, error: null }) };
    supabase.from.mockReturnValue(query);
    window.confirm = jest.fn(() => true);
    act(() => root.render(<RoomCharacterManager {...props} />));
});
afterEach(() => { act(() => root.unmount()); container.remove(); jest.clearAllMocks(); });
async function click(text) {
    const button = [...container.querySelectorAll('button')].find(item => item.textContent.includes(text));
    expect(button).toBeTruthy();
    await act(async () => button.click());
}

test('only own connected characters appear, inactive characters can be reconnected', async () => {
    expect(container.textContent).toContain('Alice');
    expect(container.textContent).not.toContain('Bob');
    expect(container.textContent).not.toContain('Other');
    await click('기존 캐릭터 추가');
    expect(container.textContent).not.toContain('Alice');
    await click('Bob');
    expect(query.update).toHaveBeenCalledWith({ is_active: true });
    expect(query.insert).not.toHaveBeenCalled();
    expect(props.onSelect).toHaveBeenCalledWith(props.characters[1]);
});

test('unlink deactivates the link and clears selection without deleting character or logs', async () => {
    await click('연결 해제');
    expect(window.confirm).toHaveBeenCalled();
    expect(query.update.mock.calls).toEqual([[{ selected_character_id: null }], [{ is_active: false }]]);
    expect(supabase.from.mock.calls.map(call => call[0])).toEqual(['room_user', 'room_character']);
    expect(props.onSelect).toHaveBeenCalledWith(null, false);
});

test('failed reconnect stays open and does not select an unconnected character', async () => {
    query.single.mockResolvedValue({ data: null, error: { message: 'denied' } });
    await click('기존 캐릭터 추가');
    await click('Bob');
    expect(container.querySelector('[role="alert"]').textContent).toBe('denied');
    expect(props.onSelect).not.toHaveBeenCalled();
});

test('new character is preserved when room connection fails', async () => {
    query.single.mockResolvedValue({ data: null, error: { message: 'connection failed' } });
    await click('새 캐릭터 생성');
    await click('save without delete');
    expect(props.onCharacterSaved).toHaveBeenCalledWith(expect.objectContaining({ character_id: 'new' }));
    expect(query.insert).toHaveBeenCalledWith({ room_id: 1, character_id: 'new', is_active: true });
    expect(container.textContent).toContain('connection failed');
});
