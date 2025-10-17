-- Fan Profiles Backup
-- Generated: 2025-10-13
-- Contains all custom fan profiles and curve points

-- Fan Profiles
INSERT INTO fan_profiles (id, system_id, profile_name, description, profile_type, is_global, is_active, created_by) VALUES
(1, NULL, 'Silent', 'Prioritizes quiet operation with low fan speeds', 'silent', true, false, 'system'),
(2, NULL, 'Balanced', 'Balanced cooling and noise levels', 'balanced', true, false, 'system'),
(3, NULL, 'Performance', 'Maximum cooling with higher fan speeds', 'performance', true, false, 'system'),
(4, NULL, 'Fans_Standard', 'Standard curve for most systems.', 'custom', true, false, 'user'),
(5, NULL, 'Test_Fans_30', 'Set Fans to 30% of their RPM when needed, keep at 0% below 60°C', 'custom', true, false, 'user'),
(6, NULL, 'Test_Fans_100', 'Set Fans to 100% RPM', 'custom', true, false, 'user'),
(7, NULL, 'Test_Fans_00', 'Set Fans to 0% and Full STOP.', 'custom', true, false, 'user'),
(8, NULL, 'Fans_Lazy', E'Stays at zero RPM till 50°C, kicks in after 50°C, stays silent till 70°C and goes full blast at 80°C.\nGood for PCH, Chipset and High RPM 8000RPM+ fans', 'custom', true, false, 'user'),
(10, NULL, 'Fans_Optimal', E'Minimise Noise and RPM below 50°C and ramp up above 60°C when performance is needed,\nBest of Both worlds', 'custom', true, false, 'user'),
(11, NULL, 'Fans_Performance', 'Cooling is a priority, ramp fans to higher RPM faster', 'custom', true, false, 'user');

-- Fan Curve Points
-- Profile: Silent (ID: 1)
INSERT INTO fan_curve_points (profile_id, temperature, fan_speed, point_order) VALUES
(1, 30.00, 20, 1), (1, 40.00, 25, 2), (1, 50.00, 35, 3),
(1, 60.00, 45, 4), (1, 70.00, 60, 5), (1, 80.00, 80, 6);

-- Profile: Balanced (ID: 2)
INSERT INTO fan_curve_points (profile_id, temperature, fan_speed, point_order) VALUES
(2, 30.00, 25, 1), (2, 40.00, 30, 2), (2, 50.00, 45, 3),
(2, 60.00, 60, 4), (2, 70.00, 75, 5), (2, 80.00, 90, 6);

-- Profile: Performance (ID: 3)
INSERT INTO fan_curve_points (profile_id, temperature, fan_speed, point_order) VALUES
(3, 30.00, 40, 1), (3, 40.00, 50, 2), (3, 50.00, 65, 3),
(3, 60.00, 75, 4), (3, 70.00, 85, 5), (3, 80.00, 100, 6);

-- Profile: Fans_Standard (ID: 4)
INSERT INTO fan_curve_points (profile_id, temperature, fan_speed, point_order) VALUES
(4, 0.00, 0, 1), (4, 30.00, 30, 2), (4, 40.00, 40, 3),
(4, 50.00, 50, 4), (4, 60.00, 70, 5), (4, 70.00, 85, 6), (4, 80.00, 100, 7);

-- Profile: Test_Fans_30 (ID: 5)
INSERT INTO fan_curve_points (profile_id, temperature, fan_speed, point_order) VALUES
(5, 0.00, 35, 1), (5, 60.00, 35, 2), (5, 70.00, 35, 3), (5, 80.00, 100, 4);

-- Profile: Test_Fans_100 (ID: 6)
INSERT INTO fan_curve_points (profile_id, temperature, fan_speed, point_order) VALUES
(6, 0.00, 100, 1), (6, 60.00, 100, 2), (6, 99.00, 100, 3);

-- Profile: Test_Fans_00 (ID: 7)
INSERT INTO fan_curve_points (profile_id, temperature, fan_speed, point_order) VALUES
(7, 0.00, 0, 1), (7, 60.00, 0, 2), (7, 99.00, 0, 3);

-- Profile: Fans_Lazy (ID: 8)
INSERT INTO fan_curve_points (profile_id, temperature, fan_speed, point_order) VALUES
(8, 0.00, 0, 1), (8, 50.00, 0, 2), (8, 60.00, 25, 3),
(8, 70.00, 50, 4), (8, 75.00, 80, 5), (8, 80.00, 100, 6);

-- Profile: Fans_Optimal (ID: 10)
INSERT INTO fan_curve_points (profile_id, temperature, fan_speed, point_order) VALUES
(10, 0.00, 0, 1), (10, 40.00, 30, 2), (10, 50.00, 40, 3),
(10, 60.00, 55, 4), (10, 70.00, 85, 5), (10, 80.00, 100, 6);

-- Profile: Fans_Performance (ID: 11)
INSERT INTO fan_curve_points (profile_id, temperature, fan_speed, point_order) VALUES
(11, 0.00, 40, 1), (11, 30.00, 40, 2), (11, 40.00, 50, 3),
(11, 50.00, 60, 4), (11, 60.00, 75, 5), (11, 70.00, 90, 6), (11, 75.00, 100, 7);
