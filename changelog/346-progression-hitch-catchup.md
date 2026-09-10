# Economy catches up cleanly after short frame stalls

If the game has a multi-second rendering or browser hiccup, economy and other one-second progression work now catch up with elapsed game time instead of lagging behind one second per later frame. Catch-up work is capped per frame so a very long pause cannot dump unlimited work into a single frame.
