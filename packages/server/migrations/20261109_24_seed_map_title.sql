-- The seed map's name in 1.6 is "Test map": the x1000y992 header, drawn
-- at the map-name field. The seed migration gave it an empty title. A map an operator has already
-- titled keeps its title.
UPDATE maps SET title = 'Test map' WHERE mx = 1000 AND my = 992 AND title = '';
